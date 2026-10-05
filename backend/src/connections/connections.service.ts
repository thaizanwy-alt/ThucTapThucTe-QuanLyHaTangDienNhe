import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { UserRole } from '../users/user-role.enum';
import { Project } from '../projects/project.entity';
import { ProjectArea } from '../projects/project-area.entity';
import { ProjectDevice } from '../devices/project-device.entity';
import { DeviceType } from '../devices/device-type.enum';
import { DevicePort } from './device-port.entity';
import { PhysicalConnection } from './physical-connection.entity';
import { ConnectionEndpoint } from './connection-endpoint.entity';
import { ConnectionKind, EndpointEnd, PortSide } from './connection.enums';
import { ConnectionRouteDto, CreateConnectionDto, CreatePortDto, EndpointDto, RewireDto, UpdatePortDto } from './dto/connection.dto';

const idKey = (id: string) => id.toLowerCase();
const faces = (type: DeviceType): PortSide[] => type === DeviceType.RACK ? [] :
  [DeviceType.NETWORK_OUTLET, DeviceType.PATCH_PANEL].includes(type) ? [PortSide.FRONT, PortSide.REAR] : [PortSide.SINGLE];
type Graph = {
  devices: Map<string, ProjectDevice>; ports: Map<string, DevicePort>;
  areas: Map<string, ProjectArea>; connections: Map<string, PhysicalConnection>; endpoints: ConnectionEndpoint[];
};

@Injectable()
export class ConnectionsService {
  constructor(private readonly database: DataSource) {}

  private async requireProject(m: EntityManager, projectId: string, lock = false) {
    const project = await m.getRepository(Project).findOne({ where: { id: projectId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!project) throw new NotFoundException('Project not found');
  }
  private async device(m: EntityManager, projectId: string, deviceId: string) {
    const device = await m.getRepository(ProjectDevice).findOneBy({ projectId, id: deviceId });
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }
  private async port(m: EntityManager, projectId: string, deviceId: string, portId: string) {
    const port = await m.getRepository(DevicePort).findOneBy({ projectId, deviceId, id: portId });
    if (!port) throw new NotFoundException('Port not found');
    return port;
  }
  private async connection(m: EntityManager, projectId: string, connectionId: string) {
    const connection = await m.getRepository(PhysicalConnection).findOneBy({ projectId, id: connectionId });
    if (!connection) throw new NotFoundException('Connection not found');
    return connection;
  }
  private async write<T>(projectId: string, user: AuthenticatedUser, action: (m: EntityManager) => Promise<T>): Promise<T> {
    if (user.role !== UserRole.MANAGER) throw new ForbiddenException();
    try {
      return await this.database.transaction(async m => {
        // Same lock as DevicesService: cardinality, occupancy, rewires and deletes serialize.
        await this.requireProject(m, projectId, true);
        return action(m);
      });
    } catch (error) {
      const value = error as { code?: string; driverError?: { code?: string } };
      const code = value?.driverError?.code ?? value?.code;
      if (code === '23505') throw new ConflictException('Port code or port side is already used');
      if (code === '23503' || code === '23001') throw new ConflictException('Related data changed or resource has dependencies');
      throw error;
    }
  }
  private async read<T>(projectId: string, action: (m: EntityManager) => Promise<T>) {
    return this.database.transaction('REPEATABLE READ', async m => {
      await this.requireProject(m, projectId);
      return action(m);
    });
  }
  private async portResponse(m: EntityManager, port: DevicePort, type: DeviceType) {
    const ends = await m.getRepository(ConnectionEndpoint).findBy({ projectId: port.projectId, portId: port.id });
    return { ...port, sides: faces(type).map(side => ({ side, connectionId: ends.find(e => e.side === side)?.connectionId ?? null })) };
  }
  async listPorts(projectId: string, deviceId: string) {
    return this.read(projectId, async m => {
      const device = await this.device(m, projectId, deviceId);
      const ports = await m.getRepository(DevicePort).find({ where: { projectId, deviceId }, order: { code: 'ASC' } });
      const results: Awaited<ReturnType<ConnectionsService['portResponse']>>[] = [];
      for (const port of ports) results.push(await this.portResponse(m, port, device.type));
      return results;
    });
  }
  async createPort(projectId: string, deviceId: string, dto: CreatePortDto, user: AuthenticatedUser) {
    return this.write(projectId, user, async m => {
      const device = await this.device(m, projectId, deviceId);
      if (!faces(device.type).length) throw new BadRequestException('Rack cannot have ports');
      const repo = m.getRepository(DevicePort);
      if ([DeviceType.CAMERA, DeviceType.AP].includes(device.type) && await repo.countBy({ projectId, deviceId })) {
        throw new ConflictException('Camera/AP can have at most one port');
      }
      const port = await repo.save(repo.create({ projectId: idKey(projectId), deviceId: device.id,
        code: dto.code.trim().toUpperCase(), description: dto.description?.trim() || null }));
      return this.portResponse(m, port, device.type);
    });
  }
  async updatePort(projectId: string, deviceId: string, portId: string, dto: UpdatePortDto, user: AuthenticatedUser) {
    return this.write(projectId, user, async m => {
      if (dto.code === undefined && dto.description === undefined) throw new BadRequestException('At least one editable field is required');
      const device = await this.device(m, projectId, deviceId);
      const port = await this.port(m, projectId, deviceId, portId);
      if (dto.code !== undefined) port.code = dto.code.trim().toUpperCase();
      if (dto.description !== undefined) port.description = dto.description?.trim() || null;
      await m.getRepository(DevicePort).save(port);
      return this.portResponse(m, port, device.type);
    });
  }
  async deletePort(projectId: string, deviceId: string, portId: string, user: AuthenticatedUser) {
    return this.write(projectId, user, async m => {
      await this.port(m, projectId, deviceId, portId);
      await m.getRepository(DevicePort).delete({ projectId, deviceId, id: portId });
    });
  }

  private async validateRoute(m: EntityManager, projectId: string, dto: ConnectionRouteDto) {
    const resolve = async (endpoint: EndpointDto) => {
      const port = await m.getRepository(DevicePort).findOneBy({ projectId, id: endpoint.portId });
      if (!port) throw new NotFoundException('Port not found');
      const device = await this.device(m, projectId, port.deviceId);
      if (!faces(device.type).includes(endpoint.side)) throw new BadRequestException('Invalid side for this device');
      return { port, device, side: endpoint.side };
    };
    const a = await resolve(dto.a);
    const b = await resolve(dto.b);
    if (a.port.id === b.port.id) throw new BadRequestException('Cannot connect a port to itself');
    const terminal = (type: DeviceType) => [DeviceType.CAMERA, DeviceType.AP].includes(type);
    const allowed = (x: typeof a, y: typeof b) => {
      if (x.device.type === DeviceType.NETWORK_OUTLET && x.side === PortSide.REAR && y.device.type === DeviceType.PATCH_PANEL && y.side === PortSide.REAR) return dto.kind === ConnectionKind.FIXED;
      if (x.device.type === DeviceType.PATCH_PANEL && x.side === PortSide.FRONT && y.device.type === DeviceType.SWITCH) return dto.kind === ConnectionKind.PATCH;
      if (terminal(x.device.type)) {
        if (y.device.type === DeviceType.PATCH_PANEL && y.side === PortSide.REAR) return dto.kind === ConnectionKind.FIXED;
        if (y.device.type === DeviceType.NETWORK_OUTLET && y.side === PortSide.FRONT) return dto.kind === ConnectionKind.PATCH;
        if (y.device.type === DeviceType.SWITCH) return [ConnectionKind.FIXED, ConnectionKind.PATCH].includes(dto.kind);
      }
      return false;
    };
    if (!allowed(a, b) && !allowed(b, a)) throw new BadRequestException('Unsupported device/side/cable pairing');
    return [a, b];
  }
  private async replaceEndpoints(m: EntityManager, connection: PhysicalConnection, dto: ConnectionRouteDto) {
    const ends = await this.validateRoute(m, connection.projectId, dto);
    const repo = m.getRepository(ConnectionEndpoint);
    // Delete and both inserts are inside the caller's transaction. Unique/FK failure restores old ends.
    await repo.delete({ projectId: connection.projectId, connectionId: connection.id });
    await repo.insert(ends.map((end, i) => ({ projectId: connection.projectId, connectionId: connection.id,
      end: i === 0 ? EndpointEnd.A : EndpointEnd.B, portId: end.port.id, side: end.side })));
  }
  async createConnection(projectId: string, dto: CreateConnectionDto, user: AuthenticatedUser) {
    return this.write(projectId, user, async m => {
      const repo = m.getRepository(PhysicalConnection);
      const connection = await repo.save(repo.create({ projectId: idKey(projectId), kind: dto.kind, version: 1,
        label: dto.label?.trim() || null, description: dto.description?.trim() || null }));
      await this.replaceEndpoints(m, connection, dto);
      return this.connectionResponse(await this.graph(m, projectId), connection);
    });
  }
  async rewire(projectId: string, connectionId: string, dto: RewireDto, user: AuthenticatedUser) {
    return this.write(projectId, user, async m => {
      const connection = await this.connection(m, projectId, connectionId);
      if (connection.version !== dto.expectedVersion) throw new ConflictException('Connection version changed; reload first');
      await this.replaceEndpoints(m, connection, dto);
      connection.kind = dto.kind;
      connection.version++;
      await m.getRepository(PhysicalConnection).save(connection);
      return this.connectionResponse(await this.graph(m, projectId), connection);
    });
  }
  async deleteConnection(projectId: string, connectionId: string, user: AuthenticatedUser) {
    return this.write(projectId, user, async m => {
      await this.connection(m, projectId, connectionId);
      await m.getRepository(ConnectionEndpoint).delete({ projectId, connectionId });
      await m.getRepository(PhysicalConnection).delete({ projectId, id: connectionId });
    });
  }
  async listConnections(projectId: string, deviceId?: string) {
    return this.read(projectId, async m => {
      if (deviceId) await this.device(m, projectId, deviceId);
      const graph = await this.graph(m, projectId);
      return [...graph.connections.values()].filter(connection => !deviceId || graph.endpoints.some(e =>
        e.connectionId === connection.id && graph.ports.get(e.portId)?.deviceId === idKey(deviceId)))
        .map(connection => this.connectionResponse(graph, connection));
    });
  }

  private async graph(m: EntityManager, projectId: string): Promise<Graph> {
    // A transaction owns one pg connection; do not queue concurrent queries on it.
    const devices = await m.getRepository(ProjectDevice).findBy({ projectId });
    const ports = await m.getRepository(DevicePort).find({ where: { projectId }, order: { code: 'ASC' } });
    const areas = await m.getRepository(ProjectArea).findBy({ projectId });
    const connections = await m.getRepository(PhysicalConnection).find({ where: { projectId }, order: { createdAt: 'ASC', id: 'ASC' } });
    const endpoints = await m.getRepository(ConnectionEndpoint).findBy({ projectId });
    return { devices: new Map(devices.map(d => [d.id, d])), ports: new Map(ports.map(p => [p.id, p])),
      areas: new Map(areas.map(a => [a.id, a])), connections: new Map(connections.map(c => [c.id, c])), endpoints };
  }
  private deviceSummary(g: Graph, deviceId: string) {
    const device = g.devices.get(idKey(deviceId))!;
    const rack = device.rackId ? g.devices.get(device.rackId) : undefined;
    const effectiveAreaId = rack ? rack.areaId : device.areaId;
    return { id: device.id, code: device.code, name: device.name, type: device.type,
      areaId: device.areaId, rackId: device.rackId, effectiveAreaId,
      area: effectiveAreaId ? g.areas.get(effectiveAreaId) ?? null : null,
      rack: rack ? { id: rack.id, code: rack.code, name: rack.name, areaId: rack.areaId } : null };
  }
  private endpointResponse(g: Graph, end: ConnectionEndpoint) {
    const port = g.ports.get(end.portId)!;
    return { portId: port.id, side: end.side, port: { id: port.id, code: port.code, description: port.description },
      device: this.deviceSummary(g, port.deviceId) };
  }
  private connectionResponse(g: Graph, connection: PhysicalConnection) {
    const ends = g.endpoints.filter(e => e.connectionId === connection.id);
    return { ...connection,
      a: this.endpointResponse(g, ends.find(e => e.end === EndpointEnd.A)!),
      b: this.endpointResponse(g, ends.find(e => e.end === EndpointEnd.B)!) };
  }
  async trace(projectId: string, deviceCode: string) {
    return this.read(projectId, async m => {
      const g = await this.graph(m, projectId);
      const device = [...g.devices.values()].find(d => d.code === deviceCode.trim().toUpperCase());
      if (!device) throw new NotFoundException('Device not found');
      if (![DeviceType.NETWORK_OUTLET, DeviceType.CAMERA, DeviceType.AP].includes(device.type)) throw new BadRequestException('Trace starts at an outlet, camera or AP');
      const source = this.deviceSummary(g, device.id);
      const paths = [...g.ports.values()].filter(p => p.deviceId === device.id).map(port => {
        let portId = port.id;
        let side = device.type === DeviceType.NETWORK_OUTLET ? PortSide.REAR : PortSide.SINGLE;
        const segments: { connectionId: string; kind: ConnectionKind; version: number;
          from: ReturnType<ConnectionsService['endpointResponse']>; to: ReturnType<ConnectionsService['endpointResponse']> }[] = [];
        const seen = new Set<string>();
        while (!seen.has(`${portId}:${side}`)) {
          seen.add(`${portId}:${side}`);
          const end = g.endpoints.find(e => e.portId === portId && e.side === side);
          if (!end) break;
          const other = g.endpoints.find(e => e.connectionId === end.connectionId && e.end !== end.end)!;
          const connection = g.connections.get(end.connectionId)!;
          const to = this.endpointResponse(g, other);
          segments.push({ connectionId: connection.id, kind: connection.kind, version: connection.version, from: this.endpointResponse(g, end), to });
          if (to.device.type === DeviceType.SWITCH) return { port, segments, complete: true, missing: null };
          portId = other.portId;
          if (to.device.type === DeviceType.NETWORK_OUTLET && other.side === PortSide.FRONT) side = PortSide.REAR;
          else if (to.device.type === DeviceType.PATCH_PANEL && other.side === PortSide.REAR) side = PortSide.FRONT;
          else break;
        }
        return { port, segments, complete: false, missing: { portId, side } };
      });
      return { device: source, area: source.area, paths };
    });
  }
}
