import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';

import { configCommand } from './config/index.js';
import { doctorCommand } from './doctor.js';
import { daemonCommand } from './daemon/index.js';
import { dailyCommand } from './daily/index.js';
import { dbCommand } from './db/index.js';
import { importCommand } from './import/index.js';
import { opsCommand } from './ops/index.js';
import { applyCommand } from './apply.js';
import { apiCommand } from './api/index.js';
import { planCommand } from './plan/index.js';
import { pluginCommand } from './plugin/index.js';
import { powerupCommand } from './powerup/index.js';
import { queryCommand } from './query.js';
import { queueCommand } from './queue/index.js';
import { remCommand } from './rem/index.js';
import { replaceCommand } from './replace/index.js';
import { searchCommand } from './search.js';
import { tableCommand } from './table/index.js';
import { tagCommand } from './tag/index.js';
import { todoCommand } from './todo/index.js';
import { topicCommand } from './topic/index.js';
import { portalCommand } from './portal/index.js';
import { stackCommand } from './stack/index.js';

import { AppConfig } from '../services/AppConfig.js';
import { resolveConfig } from '../services/Config.js';
import { ChildProcessLive } from '../services/ChildProcess.js';
import { DaemonFilesLive } from '../services/DaemonFiles.js';
import { ApiDaemonFilesLive } from '../services/ApiDaemonFiles.js';
import { FileInputLive } from '../services/FileInput.js';
import { FsAccessLive } from '../services/FsAccess.js';
import { LogWriterFactoryLive } from '../services/LogWriter.js';
import { OutputLive } from '../services/Output.js';
import { PayloadLive } from '../services/Payload.js';
import { ProcessLive } from '../services/Process.js';
import { QueueLive } from '../services/Queue.js';
import { RefResolverLive } from '../services/RefResolver.js';
import { RemDbLive } from '../services/RemDb.js';
import { StatusLineFileLive } from '../services/StatusLineFile.js';
import { SubprocessLive } from '../services/Subprocess.js';
import { SupervisorStateLive } from '../services/SupervisorState.js';
import { TmuxLive } from '../services/Tmux.js';
import { WsBridgeServerLive } from '../services/WsBridgeServer.js';
import { WsBridgeStateLive } from '../services/WsBridgeState.js';
import { WsBridgeStateFileLive } from '../services/WsBridgeStateFile.js';
import { WsClientLive } from '../services/WsClient.js';
import { HostApiClientLive } from '../services/HostApiClient.js';
import { UserConfigFileLive } from '../services/UserConfigFile.js';

import { StatusLineControllerLive } from '../runtime/status-line/StatusLineController.js';
import { StatusLineUpdaterLive } from '../runtime/status-line/StatusLineUpdater.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const remnoteDb = Options.text('remnote-db').pipe(Options.optional, Options.map(optionToUndefined));
const storeDb = Options.text('store-db').pipe(Options.optional, Options.map(optionToUndefined));
const daemonUrl = Options.text('daemon-url').pipe(Options.optional, Options.map(optionToUndefined));
const wsPort = Options.integer('ws-port').pipe(Options.optional, Options.map(optionToUndefined));
const repo = Options.text('repo').pipe(Options.optional, Options.map(optionToUndefined));
const apiBaseUrl = Options.text('api-base-url').pipe(Options.optional, Options.map(optionToUndefined));
const apiHost = Options.text('api-host').pipe(Options.optional, Options.map(optionToUndefined));
const apiPort = Options.integer('api-port').pipe(Options.optional, Options.map(optionToUndefined));
const apiBasePath = Options.text('api-base-path').pipe(Options.optional, Options.map(optionToUndefined));
const configFile = Options.text('config-file').pipe(Options.optional, Options.map(optionToUndefined));

const appConfigLive = Layer.effect(AppConfig, resolveConfig());

const statusLineUpdaterLive = StatusLineUpdaterLive.pipe(
  Layer.provide([appConfigLive, QueueLive, StatusLineFileLive, TmuxLive, WsBridgeStateLive]),
);

const statusLineLive = StatusLineControllerLive.pipe(
  Layer.provide(statusLineUpdaterLive),
  Layer.provide(appConfigLive),
);

const servicesLive = Layer.mergeAll(
  appConfigLive,
  OutputLive,
  FileInputLive,
  FsAccessLive,
  LogWriterFactoryLive,
  PayloadLive,
  DaemonFilesLive,
  ApiDaemonFilesLive,
  ProcessLive,
  ChildProcessLive,
  WsClientLive,
  HostApiClientLive,
  UserConfigFileLive,
  QueueLive,
  RefResolverLive,
  RemDbLive,
  StatusLineFileLive,
  SubprocessLive,
  SupervisorStateLive,
  WsBridgeServerLive,
  WsBridgeStateFileLive,
  statusLineLive,
);

export const rootCommand = Command.make('agent-remnote', {
  json: Options.boolean('json'),
  md: Options.boolean('md'),
  ids: Options.boolean('ids'),
  quiet: Options.boolean('quiet'),
  debug: Options.boolean('debug'),

  remnoteDb,
  storeDb,
  daemonUrl,
  wsPort,
  repo,
  apiBaseUrl,
  apiHost,
  apiPort,
  apiBasePath,
  configFile,
}).pipe(
  Command.withSubcommands([
    daemonCommand,
    apiCommand,
    stackCommand,
    queueCommand,
    applyCommand,
    pluginCommand,
    searchCommand,
    queryCommand,
    remCommand,
    dailyCommand,
    todoCommand,
    topicCommand,
    powerupCommand,
    tableCommand,
    tagCommand,
    portalCommand,
    replaceCommand,
    importCommand,
    planCommand,
    dbCommand,
    configCommand,
    doctorCommand,
    opsCommand,
  ]),
  Command.provide(servicesLive),
);
