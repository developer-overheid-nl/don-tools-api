export interface ModelsLintResult {
  apiId?: string;
  createdAt?: string;
  failures?: number;
  id?: string;
  messages?: Array<ModelsLintMessage>;
  score?: number;
  successes?: boolean;
  rulesetVersion?: string;
}
