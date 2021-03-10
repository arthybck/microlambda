import { ISecretConfig } from "./secrets";
import { IDomainConfig } from "./domain";
import { ILocalAuthorizerConfig } from "./local-authorizer";

export { IDomainConfig, ISecretConfig };

export interface IPluginConfig {
  secrets: ISecretConfig[];
  domain: IDomainConfig;
  localAuthorizer: ILocalAuthorizerConfig[] | ILocalAuthorizerConfig;
}
