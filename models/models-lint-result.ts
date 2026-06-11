export interface ModelsLintResult { 
  apiId?: string;
  createdAt?: string;
  failures?: number;
  id?: string;
  messages?: Array<ModelsLintMessage>;
  score?: number;
  successes?: boolean;
  /**
   * De gebruikte ruleset-versie voor validatie.
   */
  rulesetVersion?: string;
}

