import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { ProjectArea } from '../projects/project-area.entity';
import { ProjectSystem } from '../projects/project-system.entity';
import { Project } from '../projects/project.entity';
import { UserRole } from '../users/user-role.enum';
import { DeviceType } from './device-type.enum';
import { DevicePort } from '../connections/device-port.entity';
import { CreateProjectDeviceDto, UpdateProjectDeviceDto } from './dto/device.dto';
import { PutDeviceNetworkProfileDto } from './dto/network-profile.dto';
import { DeviceNetworkProfile } from './device-network-profile.entity';
import { ProjectDevice, ProjectDeviceResponse } from './project-device.entity';
import { ProjectDeviceSystem } from './project-device-system.entity';

const textFields = ['brand', 'model', 'serialNumber', 'description', 'locationNote'] as const;
const editableFields = ['code', 'name', ...textFields, 'areaId', 'rackId', 'capacityU', 'systemIds'] as const;

@Injectable()
export class DevicesService {
  constructor(private readonly database: DataSource) {}

  async listDevices(projectId: string): Promise<ProjectDeviceResponse[]> {
    return this.database.transaction('REPEATABLE READ', async (manager) => {
      await this.requireProject(manager, projectId);
      const devices = await manager.getRepository(ProjectDevice).find({ where: { projectId }, order: { code: 'ASC' } });
      return this.responses(manager, projectId, devices);
    });
  }

  async getDevice(projectId: string, deviceId: string): Promise<ProjectDeviceResponse> {
    return this.database.transaction('REPEATABLE READ', async (manager) => {
      const device = await this.requireDevice(manager, projectId, deviceId);
      return (await this.responses(manager, projectId, [device]))[0];
    });
  }

  async getNetworkProfile(projectId: string, deviceId: string) {
    return this.database.transaction('REPEATABLE READ', async (manager) => {
      await this.requireNetworkDevice(manager, projectId, deviceId);
      const profile = await manager.getRepository(DeviceNetworkProfile).findOneBy({ projectId, deviceId });
      return profile ? this.networkProfileResponse(manager, profile) : null;
    });
  }

  async putNetworkProfile(projectId: string, deviceId: string, dto: PutDeviceNetworkProfileDto, user: AuthenticatedUser) {
    return this.write(projectId, user, async (manager) => {
      await this.requireNetworkDevice(manager, projectId, deviceId);
      if (dto.addressMode === undefined || dto.ipAddress === undefined || dto.macAddress === undefined) {
        throw new BadRequestException('addressMode, ipAddress and macAddress are all required');
      }
      if (dto.addressMode === null && dto.ipAddress !== null) throw new BadRequestException('ipAddress requires addressMode');
      const repo = manager.getRepository(DeviceNetworkProfile);
      const profile = await repo.findOneBy({ projectId, deviceId }) ?? repo.create({ projectId, deviceId });
      profile.addressMode = dto.addressMode;
      profile.ipAddress = dto.ipAddress;
      profile.macAddress = dto.macAddress;
      await repo.save(profile);
      return this.networkProfileResponse(manager, profile);
    });
  }

  async createDevice(projectId: string, dto: CreateProjectDeviceDto, user: AuthenticatedUser): Promise<ProjectDeviceResponse> {
    return this.write(projectId, user, async (manager) => {
      const repository = manager.getRepository(ProjectDevice);
      const device = repository.create({
        projectId, type: dto.type, code: dto.code.trim().toUpperCase(), name: dto.name.trim(),
        areaId: dto.areaId ?? null, rackId: dto.rackId ?? null, capacityU: dto.capacityU ?? null,
        ...this.textChanges(dto),
      });
      for (const field of textFields) device[field] ??= null;
      await this.validateLocation(manager, device);
      await this.validateSystems(manager, projectId, dto.systemIds ?? []);
      await repository.save(device);
      await this.replaceSystems(manager, device, dto.systemIds ?? []);
      return (await this.responses(manager, projectId, [device]))[0];
    });
  }

  async updateDevice(projectId: string, deviceId: string, dto: UpdateProjectDeviceDto, user: AuthenticatedUser): Promise<ProjectDeviceResponse> {
    this.requireManager(user);
    if (dto.type !== undefined || !editableFields.some((field) => dto[field] !== undefined)) {
      throw new BadRequestException('At least one editable field is required; type cannot be changed');
    }
    return this.write(projectId, user, async (manager) => {
      const device = await this.requireDevice(manager, projectId, deviceId);
      if (dto.code !== undefined) device.code = dto.code.trim().toUpperCase();
      if (dto.name !== undefined) device.name = dto.name.trim();
      Object.assign(device, this.textChanges(dto));
      if (dto.areaId !== undefined) device.areaId = dto.areaId;
      if (dto.rackId !== undefined) device.rackId = dto.rackId;
      if (dto.capacityU !== undefined) device.capacityU = dto.capacityU;
      // Validate the final placement, including fields omitted from this PATCH.
      await this.validateLocation(manager, device);
      if (dto.systemIds !== undefined) await this.validateSystems(manager, projectId, dto.systemIds);
      // Membership-only edits must also advance the device's modification time.
      if (dto.systemIds !== undefined) device.updatedAt = new Date();
      await manager.getRepository(ProjectDevice).save(device);
      if (dto.systemIds !== undefined) await this.replaceSystems(manager, device, dto.systemIds);
      return (await this.responses(manager, projectId, [device]))[0];
    });
  }

  async deleteDevice(projectId: string, deviceId: string, user: AuthenticatedUser): Promise<void> {
    return this.write(projectId, user, async (manager) => {
      await this.requireDevice(manager, projectId, deviceId);
      const devices = manager.getRepository(ProjectDevice);
      if (await devices.countBy({ projectId, rackId: deviceId })) {
        throw new ConflictException('Rack has dependent devices');
      }
      if (await manager.getRepository(DevicePort).countBy({ projectId, deviceId })) {
        throw new ConflictException('Device has ports');
      }
      // These are the device's own memberships, not independent dependent data.
      await manager.getRepository(DeviceNetworkProfile).delete({ projectId, deviceId });
      await manager.getRepository(ProjectDeviceSystem).delete({ projectId, deviceId });
      await devices.delete({ projectId, id: deviceId });
    });
  }

  private async write<T>(projectId: string, user: AuthenticatedUser, action: (manager: EntityManager) => Promise<T>): Promise<T> {
    this.requireManager(user);
    try {
      return await this.database.transaction(async (manager) => {
        // Serialize device writes within one project, including rack placement/deletion.
        await this.requireProject(manager, projectId, true);
        return action(manager);
      });
    } catch (error) {
      const value = error as { code?: string; driverError?: { code?: string } } | null;
      const code = value?.driverError?.code ?? value?.code;
      if (code === '23505') throw new ConflictException('Device code or membership already exists');
      if (code === '23503' || code === '23001') throw new ConflictException('Related data changed or device has dependent data');
      throw error;
    }
  }

  private requireManager(user: AuthenticatedUser): void {
    if (user.role !== UserRole.MANAGER) throw new ForbiddenException();
  }

  private async requireProject(manager: EntityManager, projectId: string, lock = false): Promise<void> {
    const project = await manager.getRepository(Project).findOne({
      where: { id: projectId }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!project) throw new NotFoundException('Project not found');
  }

  private async requireDevice(manager: EntityManager, projectId: string, deviceId: string): Promise<ProjectDevice> {
    const device = await manager.getRepository(ProjectDevice).findOneBy({ projectId, id: deviceId });
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  private async requireNetworkDevice(manager: EntityManager, projectId: string, deviceId: string): Promise<ProjectDevice> {
    const device = await this.requireDevice(manager, projectId, deviceId);
    if (![DeviceType.CAMERA, DeviceType.AP].includes(device.type)) throw new BadRequestException('Network profile is only for CAMERA/AP');
    return device;
  }

  private async networkProfileResponse(manager: EntityManager, profile: DeviceNetworkProfile) {
    const duplicateIp = profile.ipAddress !== null && await manager.getRepository(DeviceNetworkProfile).exist({
      where: { projectId: profile.projectId, deviceId: Not(profile.deviceId), ipAddress: profile.ipAddress },
    });
    return { ...profile, warnings: duplicateIp ? ['DUPLICATE_IP_IN_PROJECT'] : [] };
  }

  private async validateLocation(manager: EntityManager, device: ProjectDevice): Promise<void> {
    if (device.capacityU !== null && (device.type !== DeviceType.RACK || !Number.isInteger(device.capacityU) || device.capacityU < 1)) {
      throw new BadRequestException('capacityU is only allowed for a rack and must be a positive integer');
    }
    if (device.areaId !== null && device.rackId !== null) throw new BadRequestException('Use areaId or rackId, not both');
    if (device.areaId !== null && !await manager.getRepository(ProjectArea).findOneBy({ projectId: device.projectId, id: device.areaId })) {
      throw new NotFoundException('Area not found');
    }
    if (device.rackId !== null) {
      if (![DeviceType.SWITCH, DeviceType.PATCH_PANEL].includes(device.type) || device.rackId === device.id) {
        throw new BadRequestException('Only switches and patch panels can be placed in a rack');
      }
      const rack = await this.requireDevice(manager, device.projectId, device.rackId);
      if (rack.type !== DeviceType.RACK) throw new BadRequestException('rackId must reference a rack');
    }
  }

  private async validateSystems(manager: EntityManager, projectId: string, systemIds: string[]): Promise<void> {
    if (!Array.isArray(systemIds) || new Set(systemIds.map((id) => id.toLowerCase())).size !== systemIds.length) {
      throw new BadRequestException('systemIds must be an array of distinct UUIDs');
    }
    if (systemIds.length === 0) return;
    const count = await manager.getRepository(ProjectSystem).countBy({ projectId, id: In(systemIds) });
    if (count !== systemIds.length) throw new NotFoundException('System not found');
  }

  private async replaceSystems(manager: EntityManager, device: ProjectDevice, systemIds: string[]): Promise<void> {
    const repository = manager.getRepository(ProjectDeviceSystem);
    await repository.delete({ projectId: device.projectId, deviceId: device.id });
    if (systemIds.length > 0) await repository.insert(systemIds.map((systemId) => ({ projectId: device.projectId, deviceId: device.id, systemId })));
  }

  private textChanges(dto: CreateProjectDeviceDto | UpdateProjectDeviceDto): Partial<ProjectDevice> {
    const values: Partial<ProjectDevice> = {};
    for (const field of textFields) {
      if (dto[field] !== undefined) values[field] = dto[field]?.trim() || null;
    }
    return values;
  }

  private async responses(manager: EntityManager, projectId: string, devices: ProjectDevice[]): Promise<ProjectDeviceResponse[]> {
    if (devices.length === 0) return [];
    const links = await manager.getRepository(ProjectDeviceSystem).find({ where: { projectId, deviceId: In(devices.map((device) => device.id)) } });
    const rackIds = [...new Set(devices.flatMap((device) => device.rackId ? [device.rackId] : []))];
    const racks = rackIds.length ? await manager.getRepository(ProjectDevice).find({ where: { projectId, id: In(rackIds) } }) : [];
    const rackAreas = new Map(racks.map((rack) => [rack.id.toLowerCase(), rack.areaId]));
    return devices.map((device) => ({
      ...device,
      systemIds: links.filter((link) => link.deviceId === device.id).map((link) => link.systemId).sort(),
      effectiveAreaId: device.rackId ? rackAreas.get(device.rackId.toLowerCase()) ?? null : device.areaId,
    }));
  }
}
