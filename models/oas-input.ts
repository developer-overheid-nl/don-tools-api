export interface OasInput { 
  oasBody?: string;
  oasUrl?: string;
  /**
   * Doelversie. Voor conversie: 3.0 of 3.1. Voor validatie: 2.0 of 2.1.
   */
  targetVersion?: string;
}

