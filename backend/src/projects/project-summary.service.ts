import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { UserRole } from '../users/user-role.enum';

export type StatusCounts<T extends string> = Record<T, number>;
export type TaskState = 'ASSIGNED' | 'IN_PROGRESS' | 'SUBMITTED' | 'RETURNED' | 'APPROVED';
export type IssueState = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface WorkCounts<T extends string> {
  total: number;
  byStatus: StatusCounts<T>;
}

@Injectable()
export class ProjectSummaryService {
  constructor(private readonly db: DataSource) {}

  async get(projectId: string, user: AuthenticatedUser) {
    return this.db.transaction('REPEATABLE READ', async manager => {
      await manager.query('SET TRANSACTION READ ONLY');
      // readAt marks transaction start, not the exact instant its MVCC snapshot is established.
      const [{ read_at: readAt }] = await manager.query('SELECT transaction_timestamp() AS read_at');
      const project = await manager.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
      if (!project.length) throw new NotFoundException('Project not found');

      const technician = user.role === UserRole.TECHNICIAN;
      const workWhere = `project_id = $1${technician ? ' AND assignee_id = $2' : ''}`;
      const workParams = technician ? [projectId, user.id] : [projectId];
      const [taskRow] = await manager.query(`SELECT
        count(*)::integer AS total,
        count(*) FILTER (WHERE status = 'ASSIGNED')::integer AS assigned,
        count(*) FILTER (WHERE status = 'IN_PROGRESS')::integer AS in_progress,
        count(*) FILTER (WHERE status = 'SUBMITTED')::integer AS submitted,
        count(*) FILTER (WHERE status = 'RETURNED')::integer AS returned,
        count(*) FILTER (WHERE status = 'APPROVED')::integer AS approved
        FROM project_tasks WHERE ${workWhere}`, workParams);
      const tasks: WorkCounts<TaskState> & { notApproved: number } = {
        total: taskRow.total,
        byStatus: {
          ASSIGNED: taskRow.assigned, IN_PROGRESS: taskRow.in_progress,
          SUBMITTED: taskRow.submitted, RETURNED: taskRow.returned, APPROVED: taskRow.approved,
        },
        notApproved: taskRow.total - taskRow.approved,
      };

      const [issueRow] = await manager.query(`SELECT
        count(*)::integer AS total,
        count(*) FILTER (WHERE status = 'OPEN')::integer AS open,
        count(*) FILTER (WHERE status = 'IN_PROGRESS')::integer AS in_progress,
        count(*) FILTER (WHERE status = 'RESOLVED')::integer AS resolved,
        count(*) FILTER (WHERE status = 'CLOSED')::integer AS closed
        FROM remediation_issues WHERE ${workWhere}`, workParams);
      const issues: WorkCounts<IssueState> & { notClosed: number } = {
        total: issueRow.total,
        byStatus: {
          OPEN: issueRow.open, IN_PROGRESS: issueRow.in_progress,
          RESOLVED: issueRow.resolved, CLOSED: issueRow.closed,
        },
        notClosed: issueRow.total - issueRow.closed,
      };

      const [areaRow] = await manager.query(`SELECT count(*)::integer AS total,
        count(*) FILTER (WHERE type = 'FLOOR')::integer AS floor,
        count(*) FILTER (WHERE type = 'ROOM')::integer AS room
        FROM project_areas WHERE project_id = $1`, [projectId]);
      const [systemRow] = await manager.query('SELECT count(*)::integer AS total FROM project_systems WHERE project_id = $1', [projectId]);
      const [deviceRow] = await manager.query(`SELECT count(*)::integer AS total,
        count(*) FILTER (WHERE type = 'RACK')::integer AS racks,
        count(*) FILTER (WHERE type = 'RACK' AND rack_role = 'MAIN')::integer AS main,
        count(*) FILTER (WHERE type = 'RACK' AND rack_role = 'SUB')::integer AS sub,
        count(*) FILTER (WHERE type = 'RACK' AND rack_role IS NULL)::integer AS unclassified
        FROM project_devices WHERE project_id = $1`, [projectId]);
      const inventory = {
        devicesTotal: deviceRow.total,
        areas: { total: areaRow.total, floor: areaRow.floor, room: areaRow.room },
        systemsTotal: systemRow.total,
        racks: { total: deviceRow.racks, main: deviceRow.main, sub: deviceRow.sub, unclassified: deviceRow.unclassified },
      };

      const acceptanceSql = `SELECT
        ${technician ? '' : "count(*) FILTER (WHERE a.status = 'DRAFT')::integer AS draft,"}
        count(*) FILTER (WHERE a.status = 'CONFIRMED' AND NOT EXISTS (
          SELECT 1 FROM project_acceptances next
          WHERE next.project_id = a.project_id AND next.replaces_id = a.id AND next.status = 'CONFIRMED'
        ))::integer AS confirmed_current,
        count(*) FILTER (WHERE a.status = 'CONFIRMED' AND EXISTS (
          SELECT 1 FROM project_acceptances next
          WHERE next.project_id = a.project_id AND next.replaces_id = a.id AND next.status = 'CONFIRMED'
        ))::integer AS superseded
        FROM project_acceptances a WHERE a.project_id = $1${technician ? " AND a.status = 'CONFIRMED'" : ''}`;
      const [acceptanceRow] = await manager.query(acceptanceSql, [projectId]);
      const acceptances = {
        ...(technician ? {} : { draft: acceptanceRow.draft }),
        confirmedCurrent: acceptanceRow.confirmed_current,
        superseded: acceptanceRow.superseded,
      };

      const common = {
        projectId, readAt: readAt.toISOString(),
        workScope: technician ? 'ASSIGNED_TO_ME' as const : 'PROJECT' as const,
        tasks, issues, inventory, acceptances,
      };
      if (technician) return common;

      const [inspectionRow] = await manager.query(`WITH item_counts AS (
          SELECT inspection_id, count(*) AS items,
            count(*) FILTER (WHERE result = 'PASS') AS passed,
            count(*) FILTER (WHERE result = 'NOT_CHECKED') AS not_checked
          FROM inspection_items WHERE project_id = $1 GROUP BY inspection_id
        ), open_issues AS (
          SELECT item.inspection_id, count(*) AS issues
          FROM remediation_issues issue
          JOIN inspection_items item ON item.id = issue.item_id AND item.project_id = issue.project_id
          WHERE issue.project_id = $1 AND issue.status <> 'CLOSED'
          GROUP BY item.inspection_id
        )
        SELECT count(*)::integer AS total,
          count(*) FILTER (WHERE items.items > 0 AND items.passed = items.items
            AND COALESCE(open_issues.issues, 0) = 0)::integer AS passed,
          count(*) FILTER (WHERE items.items > 0 AND items.not_checked = items.items
            AND COALESCE(open_issues.issues, 0) = 0)::integer AS not_checked
        FROM project_inspections inspection
        LEFT JOIN item_counts items ON items.inspection_id = inspection.id
        LEFT JOIN open_issues ON open_issues.inspection_id = inspection.id
        WHERE inspection.project_id = $1`, [projectId]);
      const inspections = {
        total: inspectionRow.total,
        passed: inspectionRow.passed,
        notChecked: inspectionRow.not_checked,
        pendingOrFailed: inspectionRow.total - inspectionRow.passed - inspectionRow.not_checked,
      };
      return { ...common, inspections };
    });
  }
}
