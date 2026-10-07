export interface ProblemJson {
  detail?: string;
  errors?: Array<ProblemJsonErrorsInner>;
  status?: number;
  title?: string;
}
