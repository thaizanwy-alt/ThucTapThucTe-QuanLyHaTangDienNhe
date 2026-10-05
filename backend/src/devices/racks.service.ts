import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { Project } from '../projects/project.entity';
import { ProjectArea } from '../projects/project-area.entity';
import { UserRole } from '../users/user-role.enum';
import { DeviceType } from './device-type.enum';
import { PutPlacementDto, UpdateRackDto } from './dto/rack-layout.dto';
import { ProjectDevice } from './project-device.entity';
import { ProjectDeviceSystem } from './project-device-system.entity';
import { MountMode, RackRole } from './rack-layout.enums';
import { RackServedArea } from './rack-served-area.entity';

const idKey = (value: string) => value.toLowerCase();
const rackable = new Set<DeviceType>([
  DeviceType.SWITCH, DeviceType.PATCH_PANEL, DeviceType.UPS, DeviceType.PDU,
  DeviceType.NVR, DeviceType.ROUTER, DeviceType.ODF, DeviceType.CABLE_MANAGER, DeviceType.SHELF,
]);

@Injectable()
export class RacksService {
  constructor(private readonly database: DataSource) {}

  private async requireProject(m: EntityManager, projectId: string, lock = false): Promise<void> {
    const project = await m.getRepository(Project).findOne({
      where: { id: projectId }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!project) throw new NotFoundException('Project not found');
  }

  private async requireDevice(m: EntityManager, projectId: string, deviceId: string): Promise<ProjectDevice> {
    const device = await m.getRepository(ProjectDevice).findOneBy({ projectId, id: deviceId });
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  private async requireRack(m: EntityManager, projectId: string, rackId: string): Promise<ProjectDevice> {
    const rack = await this.requireDevice(m, projectId, rackId);
    if (rack.type !== DeviceType.RACK) throw new NotFoundException('Rack not found');
    return rack;
  }

  private read<T>(projectId: string, action: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.database.transaction('REPEATABLE READ', async m => {
      await this.requireProject(m, projectId);
      return action(m);
    });
  }

  private async write<T>(projectId: string, user: AuthenticatedUser, action: (m: EntityManager) => Promise<T>): Promise<T> {
    if (user.role !== UserRole.MANAGER) throw new ForbiddenException();
    try {
      return await this.database.transaction(async m => {
        // Shared with DevicesService/ConnectionsService: serialize all writes in one project.
        await this.requireProject(m, projectId, true);
        return action(m);
      });
    } catch (error) {
      const value = error as { code?: string; driverError?: { code?: string } } | null;
      const code = value?.driverError?.code ?? value?.code;
      if (['23P01', '23505', '23503', '23514'].includes(code ?? '')) {
        throw new ConflictException('Rack layout changed or has dependent data');
      }
      throw error;
    }
  }

  private async servedAreaIds(m: EntityManager, projectId: string, rackId: string): Promise<string[]> {
    const rows = await m.getRepository(RackServedArea).findBy({ projectId, rackId });
    return rows.map(row => row.areaId).sort();
  }

  async listRacks(projectId: string) {
    return this.read(projectId, async m => {
      const racks = await m.getRepository(ProjectDevice).find({
        where: { projectId, type: DeviceType.RACK }, order: { code: 'ASC' },
      });
      const served = await m.getRepository(RackServedArea).findBy({ projectId });
      return racks.map(rack => ({
        ...rack, servedAreaIds: served.filter(row => idKey(row.rackId) === idKey(rack.id)).map(row => row.areaId).sort(),
      }));
    });
  }

  async getLayout(projectId: string, rackId: string) {
    return this.read(projectId, async m => {
      const rack = await this.requireRack(m, projectId, rackId);
      const devices = await m.getRepository(ProjectDevice).findBy({ projectId, rackId: rack.id });
      const positioned = devices.filter(device => device.mountMode === MountMode.U && device.startU !== null)
        .sort((a, b) => b.startU! - a.startU! || a.code.localeCompare(b.code));
      const zeroU = devices.filter(device => device.mountMode === MountMode.ZERO_U).sort((a, b) => a.code.localeCompare(b.code));
      const unplaced = devices.filter(device => device.mountMode === null ||
        (device.mountMode === MountMode.U && device.startU === null)).sort((a, b) => a.code.localeCompare(b.code));
      return {
        rack: { ...rack, servedAreaIds: await this.servedAreaIds(m, projectId, rack.id) },
        positioned, unplaced, zeroU,
        occupiedU: positioned.reduce((sum, device) => sum + device.heightU!, 0),
      };
    });
  }

  async updateRack(projectId: string, rackId: string, dto: UpdateRackDto, user: AuthenticatedUser) {
    if (!(['rackRole', 'parentRackId', 'areaId', 'capacityU', 'servedAreaIds'] as const)
      .some(field => dto[field] !== undefined)) {
      throw new BadRequestException('At least one rack field is required');
    }
    return this.write(projectId, user, async m => {
      const rack = await this.requireRack(m, projectId, rackId);
      if (dto.rackRole !== undefined) rack.rackRole = dto.rackRole;
      if (dto.parentRackId !== undefined) rack.parentRackId = dto.parentRackId;
      if (dto.areaId !== undefined) rack.areaId = dto.areaId;
      if (dto.capacityU !== undefined) rack.capacityU = dto.capacityU;
      if (rack.areaId !== null && !await m.getRepository(ProjectArea).exist({ where: { projectId, id: rack.areaId } })) {
        throw new NotFoundException('Area not found');
      }
      const served = dto.servedAreaIds ?? await this.servedAreaIds(m, projectId, rack.id);
      if (rack.rackRole !== null && (rack.areaId === null || rack.capacityU === null || served.length === 0)) {
        throw new BadRequestException('Configured rack requires placement, capacity and served areas');
      }
      if (rack.rackRole === RackRole.SUB) {
        if (rack.parentRackId === null || idKey(rack.parentRackId) === idKey(rack.id)) {
          throw new BadRequestException('SUB requires a different MAIN parent');
        }
        const parent = await this.requireRack(m, projectId, rack.parentRackId);
        if (parent.rackRole !== RackRole.MAIN) throw new BadRequestException('SUB parent must be MAIN');
      } else if (rack.parentRackId !== null) {
        throw new BadRequestException('Only SUB can have a parent rack');
      }
      if (rack.rackRole !== RackRole.MAIN && await m.getRepository(ProjectDevice).exist({
        where: { projectId, parentRackId: rack.id },
      })) throw new ConflictException('MAIN rack still has SUB racks');
      if (dto.servedAreaIds !== undefined) {
        if (new Set(served.map(idKey)).size !== served.length) throw new BadRequestException('servedAreaIds must be unique');
        for (const areaId of served) {
          if (!await m.getRepository(ProjectArea).exist({ where: { projectId, id: areaId } })) {
            throw new NotFoundException('Served Area not found');
          }
        }
      }
      const installed = await m.getRepository(ProjectDevice).findBy({ projectId, rackId: rack.id });
      if (installed.some(item => item.startU !== null &&
        (rack.capacityU === null || item.startU + item.heightU! - 1 > rack.capacityU))) {
        throw new ConflictException('Rack capacity is below an existing placement');
      }
      await m.getRepository(ProjectDevice).save(rack);
      if (dto.servedAreaIds !== undefined) {
        const links = m.getRepository(RackServedArea);
        await links.delete({ projectId, rackId: rack.id });
        if (served.length) await links.insert(served.map(areaId => ({ projectId, rackId: rack.id, areaId })));
      }
      return { ...rack, servedAreaIds: served.map(idKey).sort() };
    });
  }

  async putPlacement(projectId: string, deviceId: string, dto: PutPlacementDto, user: AuthenticatedUser) {
    if (['areaId', 'rackId', 'mountMode', 'startU', 'heightU'].some(key => !Object.prototype.hasOwnProperty.call(dto, key))) {
      throw new BadRequestException('All placement fields are required');
    }
    return this.write(projectId, user, async m => {
      const device = await this.requireDevice(m, projectId, deviceId);
      if (device.type === DeviceType.RACK) throw new BadRequestException('Use rack configuration for RACK placement');
      if (dto.areaId !== null && dto.rackId !== null) throw new BadRequestException('Use areaId or rackId, not both');
      let rack: ProjectDevice | null = null;
      if (dto.areaId !== null && !await m.getRepository(ProjectArea).exist({ where: { projectId, id: dto.areaId } })) {
        throw new NotFoundException('Area not found');
      }
      if (dto.rackId === null) {
        if (dto.mountMode !== null || dto.startU !== null || dto.heightU !== null) {
          throw new BadRequestException('U placement requires rackId');
        }
      } else {
        if (!rackable.has(device.type)) throw new BadRequestException('Device type cannot be placed in a rack');
        rack = await this.requireRack(m, projectId, dto.rackId);
        if (dto.mountMode === null) {
          if (dto.startU !== null || dto.heightU !== null) throw new BadRequestException('Unplaced device cannot have U coordinates');
        } else if (dto.mountMode === MountMode.ZERO_U) {
          if (device.type !== DeviceType.PDU || dto.startU !== null || dto.heightU !== 0) {
            throw new BadRequestException('ZERO_U is only for PDU and uses heightU 0');
          }
        } else if (dto.mountMode === MountMode.U) {
          if (dto.heightU === null || dto.heightU < 1 || (dto.startU !== null && dto.startU < 1)) {
            throw new BadRequestException('U placement requires positive heightU and startU');
          }
          if (dto.startU !== null) {
            if (rack.capacityU === null || dto.startU + dto.heightU - 1 > rack.capacityU) {
              throw new ConflictException('Placement exceeds rack capacity');
            }
            const others = await m.getRepository(ProjectDevice).findBy({ projectId, rackId: rack.id, mountMode: MountMode.U });
            if (others.some(other => other.id !== device.id && other.startU !== null &&
              dto.startU! <= other.startU + other.heightU! - 1 &&
              other.startU <= dto.startU! + dto.heightU! - 1)) {
              throw new ConflictException('Rack U range is occupied');
            }
          }
        } else throw new BadRequestException('Invalid mountMode');
      }
      device.areaId = dto.areaId;
      device.rackId = rack?.id ?? null;
      device.mountMode = dto.mountMode;
      device.startU = dto.startU;
      device.heightU = dto.heightU;
      await m.getRepository(ProjectDevice).save(device);
      const links = await m.getRepository(ProjectDeviceSystem).findBy({ projectId, deviceId: device.id });
      return { ...device, systemIds: links.map(link => link.systemId).sort(),
        effectiveAreaId: rack ? rack.areaId : device.areaId };
    });
  }
}
