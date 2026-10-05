import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { EndpointEnd, PortSide } from './connection.enums';

@Entity({ name: 'connection_endpoints' })
@Index('UQ_connection_endpoints_face', ['projectId', 'portId', 'side'], { unique: true })
@Index('UQ_connection_endpoints_port', ['connectionId', 'portId'], { unique: true })
@Index('IDX_connection_endpoints_project_connection', ['projectId', 'connectionId'])
export class ConnectionEndpoint {
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @PrimaryColumn({ name: 'connection_id', type: 'uuid' }) connectionId!: string;
  @PrimaryColumn({ type: 'enum', enum: EndpointEnd, enumName: 'endpoint_end_enum' }) end!: EndpointEnd;
  @Column({ name: 'port_id', type: 'uuid' }) portId!: string;
  @Column({ type: 'enum', enum: PortSide, enumName: 'port_side_enum' }) side!: PortSide;
}
