/** P10-01 — Reporting Engine Types */

export interface StageDistributionItem {
  stage: string;
  count: number;
  percentage: number;
  color: string;
}

export interface RevenuePipelineItem {
  stage: string;
  revenue: number;
  projectCount: number;
  averageValue: number;
}

export interface CycleTimeItem {
  stage: string;
  avgDays: number;
  minDays: number;
  maxDays: number;
  projectCount: number;
}

export interface StuckProjectInfo {
  projectId: string;
  projectName: string;
  customerName: string;
  currentStage: string;
  stuckDays: number;
  stageEnteredAt: string;
  assignedTo?: string;
}

export interface ProjectKpiSummary {
  totalProjects: number;
  activeProjects: number;
  archivedProjects: number;
  totalCapacityKw: number;
  averageCapacityKw: number;
  projectsByStageCount: number; // stages with projects
}

export interface ProjectPipelineReport {
  stageDistribution: StageDistributionItem[];
  revenuePipeline: RevenuePipelineItem[];
  cycleTimes: CycleTimeItem[];
  stuckProjects: StuckProjectInfo[];
  kpis: ProjectKpiSummary;
  generatedAt: string;
}

export interface CsvExportRow {
  [key: string]: string | number | undefined;
}
