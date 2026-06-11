export * from './models-keycloak-client-result';
export * from './models-lint-message';
export * from './models-lint-message-info';
export * from './models-lint-result';
export * from './oas-input';
export * from './untrust-client-input';

export {};

declare global {
  type ModelsKeycloakClientResult = import('./models-keycloak-client-result').ModelsKeycloakClientResult;
  type ModelsLintMessage = import('./models-lint-message').ModelsLintMessage;
  type ModelsLintMessageInfo = import('./models-lint-message-info').ModelsLintMessageInfo;
  type ModelsLintResult = import('./models-lint-result').ModelsLintResult;
  type OasInput = import('./oas-input').OasInput;
  type UntrustClientInput = import('./untrust-client-input').UntrustClientInput;
}
