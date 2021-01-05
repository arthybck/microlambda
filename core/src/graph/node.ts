import { DependenciesGraph, isService } from './dependencies-graph';
import { existsSync } from 'fs';
import { join } from 'path';
import { Package, Service } from './';
import { TranspilingStatus, TypeCheckStatus } from './enums/compilation.status';
import chalk from 'chalk';
import { ChildProcess, spawn } from 'child_process';
import { BehaviorSubject, Observable } from 'rxjs';
import { RecompilationScheduler } from '../scheduler';
import { IPCSocketsManager } from '../ipc/socket';
import { getBinary } from '../external-binaries';
import { compileFiles } from '../typescript';
import { checksums, IChecksums } from '../checksums';
import { FSWatcher, watch } from 'chokidar';
import { Project, Workspace } from '@yarnpkg/core';
import { getName } from '../yarn/project';

enum NodeStatus {
  DISABLED,
  ENABLED,
}

export abstract class Node {
  protected readonly name: string;
  protected readonly location: string;
  protected readonly graph: DependenciesGraph;
  protected readonly dependencies: Node[];

  private readonly version: string;
  private readonly private: boolean;

  protected transpilingStatus: TranspilingStatus;
  protected transpilingPromise: Promise<void>;

  protected typeCheckStatus: TypeCheckStatus;
  protected typeCheckProcess: ChildProcess;
  private _typeCheckLogs: string[] = [];

  private _checksums: IChecksums;
  private _lastTypeCheck: string;

  private nodeStatus: NodeStatus;
  protected _ipc: IPCSocketsManager;

  protected _scheduler: RecompilationScheduler;
  private _watchers: FSWatcher[] = [];

  private _tscLogs$: BehaviorSubject<string> = new BehaviorSubject('');
  private _typeCheck$: BehaviorSubject<TypeCheckStatus> = new BehaviorSubject<TypeCheckStatus>(TypeCheckStatus.NOT_CHECKED);
  private _transpiled$: BehaviorSubject<TranspilingStatus> = new BehaviorSubject<TranspilingStatus>(TranspilingStatus.NOT_TRANSPILED);

  public typeCheck$ = this._typeCheck$.asObservable();
  public transpiled$ = this._transpiled$.asObservable();
  public tscLogs$ = this._tscLogs$.asObservable();

  public constructor(
    scheduler: RecompilationScheduler,
    graph: DependenciesGraph,
    node: Workspace,
    nodes: Set<Node>,
    project: Project,
  ) {
    const logger = graph.logger.log('node');
    logger.debug('Building node', getName(node));
    this.graph = graph;
    this.name = getName(node);
    this.version = node.manifest.version;
    this.private = node.manifest.private;
    this.location = node.cwd;
    this.nodeStatus = NodeStatus.DISABLED;
    this.transpilingStatus = TranspilingStatus.NOT_TRANSPILED;
    this.typeCheckStatus = TypeCheckStatus.NOT_CHECKED;
    this._scheduler = scheduler;
    const workspaces = project.workspaces;
    const dependentWorkspaces: Node[] = [];
    const dependencies = Array.from(node.manifest.dependencies.values());
    const devDependencies = Array.from(node.manifest.devDependencies.values());
    for (const descriptor of dependencies.concat(devDependencies)) {
      const name = getName(descriptor);
      const alreadyBuilt = Array.from(nodes).find((n) => n.name === name);
      if (alreadyBuilt) {
        logger.debug('Dependency is already built', alreadyBuilt);
        dependentWorkspaces.push(alreadyBuilt);
        continue;
      }
      logger.debug('Building dependency', descriptor);
      const workspace = workspaces.find((w) => getName(w) === name);
      if (!workspace) {
        logger.debug('is external dependency', name);
        continue;
      }
      logger.debug('Is service', { name, result: isService(workspace.cwd) });
      dependentWorkspaces.push(
        isService(workspace.cwd)
          ? new Service(scheduler, graph, workspace, nodes, project)
          : new Package(scheduler, graph, workspace, nodes, project),
      );
    }
    this.dependencies = dependentWorkspaces;
    logger.debug('Node built', this.name);
    nodes.add(this);
  }

  get tscLogs(): string[] {
    return this._typeCheckLogs;
  }

  get lastTypeCheck(): string {
    return this._lastTypeCheck;
  }

  public enable(): void {
    this.nodeStatus = NodeStatus.ENABLED;
  }

  public disable(): void {
    this.nodeStatus = NodeStatus.DISABLED;
  }

  public registerIPCServer(sockets: IPCSocketsManager): void {
    this._ipc = sockets;
  }

  public isEnabled(): boolean {
    return this.nodeStatus === NodeStatus.ENABLED;
  }

  public isService(): boolean {
    this.getGraph()
      .logger.log('node')
      .debug('Is service', {
        node: this.getName(),
        location: join(this.location, 'serverless.yml'),
        result: existsSync(join(this.location, 'serverless.yml')),
      });
    return existsSync(join(this.location, 'serverless.yml')) || existsSync(join(this.location, 'serverless.yaml'));
  }

  public getTranspilingStatus(): TranspilingStatus {
    return this.transpilingStatus;
  }

  public getTypeCheckStatus(): TypeCheckStatus {
    return this.typeCheckStatus;
  }

  public getChildren(): Node[] {
    return this.dependencies;
  }

  public getGraph(): DependenciesGraph {
    return this.graph;
  }

  public getVersion(): string {
    return this.version;
  }

  public getChild(name: string): Node {
    return this.dependencies.find((d) => d.name === name);
  }

  public setTranspilingStatus(status: TranspilingStatus): void {
    this.transpilingStatus = status;
    if (this._ipc) {
      this.getGraph()
        .logger.log('node')
        .debug('Notifying IPC server of graph update');
      this._ipc.graphUpdated();
    }
    this._transpiled$.next(this.transpilingStatus);
  }

  public setTypeCheckingStatus(status: TypeCheckStatus): void {
    this.typeCheckStatus = status;
    this._typeCheck$.next(this.typeCheckStatus);
  }

  public isRoot(): boolean {
    return this.getDependent().length === 0;
  }

  public getName(): string {
    return this.name;
  }
  public getLocation(): string {
    return this.location;
  }

  public getDependencies(): Node[] {
    const deps: Node[] = [];
    this._getDependencies(deps);
    return deps;
  }

  private _getDependencies(deps: Node[]): void {
    for (const dep of this.dependencies) {
      deps.push(dep);
      dep._getDependencies(deps);
    }
  }

  /**
   * Get all dependents nodes.
   */
  public getDependent(): Node[] {
    const dependent = this.graph.getNodes().filter((n) =>
      n
        .getDependencies()
        .map((n) => n.name)
        .includes(this.name),
    );
    this.getGraph()
      .logger.log('node')
      .silly(
        `Nodes depending upon ${this.name}`,
        dependent.map((d) => d.name),
      );
    return dependent;
  }

  /**
   * Get the direct parents in dependency tree.
   */
  public getParents(): Node[] {
    return this.graph.getNodes().filter((n) => n.dependencies.some((d) => d.name === this.name));
  }

  public transpile(): Observable<Node> {
    return new Observable<Node>((observer) => {
      switch (this.transpilingStatus) {
        case TranspilingStatus.TRANSPILED:
        case TranspilingStatus.ERROR_TRANSPILING:
        case TranspilingStatus.NOT_TRANSPILED:
          this.transpilingPromise = this._startTranspiling();
          break;
        case TranspilingStatus.TRANSPILING:
          this.getGraph()
            .logger.log('node')
            .info('Package already transpiling', this.name);
          break;
      }
      this.transpilingPromise
        .then(() => {
          this.getGraph()
            .logger.log('node')
            .info('Package transpiled', this.name);
          observer.next(this);
          this.setTranspilingStatus(TranspilingStatus.TRANSPILED);
          return observer.complete();
        })
        .catch((err) => {
          this.getGraph()
            .logger.log('node')
            .info(`Error transpiling ${this.getName()}`, err);
          this.setTranspilingStatus(TranspilingStatus.ERROR_TRANSPILING);
          return observer.error(err);
        });
    });
  }

  public performTypeChecking(force = false): Observable<Node> {
    return new Observable<Node>((observer) => {
      switch (this.typeCheckStatus) {
        case TypeCheckStatus.SUCCESS:
        case TypeCheckStatus.ERROR:
        case TypeCheckStatus.NOT_CHECKED:
          this._startTypeChecking(force).then((action) => {
            if (action.recompile) {
              this._watchTypeChecking().subscribe(
                (next) => observer.next(next),
                (err) => observer.error(err),
                () => {
                  // Update checksums
                  if (action.checksums != null) {
                    checksums(this, this.getGraph().logger)
                      .write(action.checksums)
                      .then(() => {
                        this.getGraph()
                          .logger.log('node')
                          .info('Checksum written', this.name);
                        this._checksums = action.checksums;
                        observer.complete();
                      })
                      .catch((e) => {
                        this.getGraph()
                          .logger.log('node')
                          .debug(e);
                        this.getGraph()
                          .logger.log('node')
                          .warn(
                            `Error caching checksum for node ${this.name}. Next time node will be recompiled event if source does not change`,
                          );
                        observer.complete();
                      });
                  } else {
                    observer.complete();
                  }
                },
              );
            } else {
              this.getGraph()
                .logger.log('node')
                .info(`Skipped type-checking of ${this.name}: sources did not change`);
              this.setTypeCheckingStatus(TypeCheckStatus.SUCCESS);
              this._typeCheckLogs = [
                'Safe-compilation skipped, sources did not change since last type check. Checksums:',
                JSON.stringify(this._checksums, null, 2),
              ];
              observer.next(this);
              observer.complete();
            }
          });
          break;
        case TypeCheckStatus.CHECKING:
          // Already compiling, just wait for it to complete
          this._watchTypeChecking().subscribe(
            (next) => observer.next(next),
            (err) => observer.error(err),
            () => observer.complete(),
          );
          break;
      }
    });
  }

  private async _startTranspiling(): Promise<void> {
    this.setTranspilingStatus(TranspilingStatus.TRANSPILING);
    // Using directly typescript API
    this.getGraph()
      .logger.log('node')
      .info('Fast-compiling using transpile-only', this.name);
    return compileFiles(this.location, this.getGraph().logger);
  }

  private async _startTypeChecking(force = false): Promise<{ recompile: boolean; checksums: IChecksums }> {
    this.setTypeCheckingStatus(TypeCheckStatus.CHECKING);
    let recompile = true;
    let currentChecksums: IChecksums = null;
    const checksumUtils = checksums(this, this.getGraph().logger);
    if (!force) {
      // FIXME: Checksums => all dependencies nodes must also have no changes to be considered no need to recompile
      try {
        const oldChecksums = await checksumUtils.read();
        currentChecksums = await checksumUtils.calculate();
        this._checksums = currentChecksums;
        recompile = checksumUtils.compare(oldChecksums, currentChecksums);
      } catch (e) {
        currentChecksums = await checksumUtils.calculate().catch(() => {
          return null;
        });
        this.getGraph()
          .logger.log('node')
          .warn('Error evaluating checksums for node', this.name);
        this.getGraph()
          .logger.log('node')
          .debug(e);
      }
      this.getGraph()
        .logger.log('node')
        .info('Safe-compiling performing type-checks', this.name);
    } else {
      try {
        currentChecksums = await checksumUtils.calculate();
      } catch (e) {
        this.getGraph()
          .logger.log('node')
          .warn('Error evaluating checksums for node', this.name);
      }
    }
    if (recompile) {
      this.typeCheckProcess = spawn(getBinary('tsc', this.graph.getProjectRoot(), this.getGraph().logger, this), {
        cwd: this.location,
        env: { ...process.env, FORCE_COLOR: '2' },
      });
      this.typeCheckProcess.stderr.on('data', (data) => {
        this.getGraph()
          .logger.log('tsc')
          .error(`${chalk.bold(this.name)}: ${data}`);
        this._handleTscLogs(data);
      });
      this.typeCheckProcess.stdout.on('data', (data) => {
        this.getGraph()
          .logger.log('tsc')
          .info(`${chalk.bold(this.name)}: ${data}`);
        this._handleTscLogs(data);
      });
    }
    return { recompile, checksums: currentChecksums };
  }

  private _handleTscLogs(data: Buffer): void {
    this._typeCheckLogs.push(data.toString());
    this._tscLogs$.next(data.toString());
  }

  private _watchTypeChecking(): Observable<Node> {
    return new Observable<Node>((observer) => {
      this.typeCheckProcess.on('close', (code) => {
        this.getGraph()
          .logger.log('node')
          .silly('npx tsc process closed');
        if (code === 0) {
          this.setTypeCheckingStatus(TypeCheckStatus.SUCCESS);
          this.getGraph()
            .logger.log('node')
            .info(`Package safe-compiled ${this.getName()}`);
          observer.next(this);
          this._lastTypeCheck = new Date().toISOString();
          // this.compilationProcess.removeAllListeners('close');
          return observer.complete();
        } else {
          this.setTypeCheckingStatus(TypeCheckStatus.ERROR);
          this.getGraph()
            .logger.log('node')
            .info(`Error safe-compiling ${this.getName()}`);
          // this.compilationProcess.removeAllListeners('close');
          return observer.error();
        }
      });
      this.typeCheckProcess.on('error', (err) => {
        this.getGraph()
          .logger.log('node')
          .silly('npx tsc process error');
        this.getGraph()
          .logger.log('node')
          .error(err);
        this.setTypeCheckingStatus(TypeCheckStatus.ERROR);
        this.getGraph()
          .logger.log('node')
          .info(`Error safe-compiling ${this.getName()}`, err);
        // this.compilationProcess.removeAllListeners('error');
        return observer.error(err);
      });
    });
  }

  watch(): void {
    this.getGraph()
      .logger.log('node')
      .info('Watching sources', `${this.location}/src/**/*.{ts,js,json}`);
    const watcher = watch(`${this.location}/src/**/*.{ts,js,json}`);
    watcher.on('change', (path) => {
      this.getGraph()
        .logger.log('node')
        .info(`${chalk.bold(this.name)}: ${path} changed. Recompiling`);
      this._scheduler.fileChanged(this);
    });
    this._watchers.push(watcher);
  }

  protected unwatch(): void {
    this._watchers.forEach((w) => w.close());
  }
}