"use strict";

import { ILogger, ServerlessInstance } from "./types";
import { IPluginConfig, validateConfig } from "./config";
import {
  ConfigReader,
  DependenciesGraph,
  getGraphFromYarnProject,
  getProjectRoot,
  IConfig,
  Service,
} from "@microlambda/core";
import { createLogger } from "./utils";
import {
  afterDeploy,
  afterRemove,
  beforeDeploy,
  beforeOffline,
  beforeRemove,
  createUpdateSecrets,
  deleteSecrets,
  packageService,
  replaceAuthorizer,
} from "./features";

class ServerlessMicrolambdaPlugin {
  private static _pluginName = "Serverless Microlambda";
  public serverless: ServerlessInstance;
  public commands: Record<string, unknown>;
  public hooks: Record<string, unknown>;

  private _pluginConfig: IPluginConfig | undefined;
  private _graph: DependenciesGraph | undefined;
  private _config: IConfig | undefined;
  private _service: Service | undefined;
  private _outDir: string | undefined;
  private readonly _log: ILogger;

  constructor(serverless: ServerlessInstance) {
    this.serverless = serverless;
    this._log = createLogger(
      this.serverless,
      ServerlessMicrolambdaPlugin._pluginName
    );
    this.commands = {};
    const region = this.serverless.providers.aws.getRegion();
    const stage = this.serverless.service.provider.stage;
    const stackName =
      this.serverless.service.provider.stackName ||
      `${this.serverless.service.service}-${stage}`;
    // Check that valid microlambda service
    // Validate configuration
    this.hooks = {
      "before:invoke:local:invoke": async (): Promise<void> => {
        this.serverless.cli.log("before:invoke:local:invoke");
      },
      "after:invoke:local:invoke": async (): Promise<void> => {
        this.serverless.cli.log("after:invoke:local:invoke");
      },
      "before:offline:start": this._plugHook(async () =>
        beforeOffline(this.serverless, this._service, this._log)
      ),
      "before:offline:start:init": this._plugHook(async () =>
        beforeOffline(this.serverless, this._service, this._log)
      ),
      "before:package:createDeploymentArtifacts": this._plugHook(async () =>
        packageService(this.serverless, this._service, this._log)
      ),
      "after:package:createDeploymentArtifacts": async (): Promise<void> => {
        // Cleanup
        this.serverless.cli.log("after:package:createDeploymentArtifacts");
      },
      "before:deploy:function:packageFunction": this._plugHook(async () =>
        packageService(this.serverless, this._service, this._log)
      ),
      "before:deploy:deploy": this._plugHook(
        async (): Promise<void> => {
          replaceAuthorizer(this.serverless, this._pluginConfig, this._log);
          await createUpdateSecrets(
            region,
            this._pluginConfig?.secrets || [],
            this._log
          );
          await beforeDeploy(
            region,
            this._pluginConfig?.domain?.domainName,
            this.serverless.service.service,
            this._log
          );
        }
      ),
      "after:deploy:deploy": this._plugHook(async () =>
        afterDeploy(
          region,
          stackName,
          stage,
          this._pluginConfig?.domain,
          this._log
        )
      ),
      "before:remove:remove": this._plugHook(async () => {
        this._loadConfig();
        await deleteSecrets(
          region,
          this._pluginConfig?.secrets || [],
          this._log
        );
        await beforeRemove(region, this._pluginConfig?.domain, this._log);
      }),
      "after:remove:remove": this._plugHook(async () =>
        afterRemove(region, this._pluginConfig?.domain?.domainName, this._log)
      ),
    };
  }

  private _plugHook(
    func: () => Promise<unknown> | unknown
  ): () => Promise<void> {
    return async (): Promise<void> => {
      this._loadConfig();
      await this._resolveCurrentService();
      if (typeof func === "function") {
        await func();
      } else {
        await func;
      }
    };
  }

  private _loadConfig(): void {
    if (!this._pluginConfig) {
      this._pluginConfig = validateConfig(
        this.serverless.service.custom.microlambda
      );
      this._log.debug("Configuration validated", this._pluginConfig);
    }
  }

  private async _getDependenciesGraph(): Promise<void> {
    if (!this._graph) {
      const projectRoot = getProjectRoot();
      this._log.info(`Project root resolved ${projectRoot}`);
      this._config = new ConfigReader().readConfig();
      this._graph = await getGraphFromYarnProject(projectRoot, this._config);
      this._log.info(
        `Dependencies graph resolved: ${this._graph.getNodes().length} nodes`
      );
    }
  }

  private async _resolveCurrentService(): Promise<void> {
    if (!this._graph) {
      await this._getDependenciesGraph();
    }
    if (!this._service) {
      this._log.debug(`cwd: ${process.cwd()}`);
      this._service = this._graph
        ?.getNodes()
        .find((s) => s.getLocation() === process.cwd()) as Service;
      if (!this._service) {
        this._log.error(`Error: cannot resolve microlambda service`);
        process.exit(1);
      }
      this._log.info(`Microlambda service resolved ${this._service.getName()}`);
      for (const dep of new Set(this._service.getDependencies())) {
        this._log.info(`-- Depends on ${dep.getName()}`);
      }
    }
  }
}

export = ServerlessMicrolambdaPlugin;
