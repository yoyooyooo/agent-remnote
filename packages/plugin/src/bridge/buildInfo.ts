declare const __REMNOTE_PLUGIN_BUILD_INFO__:
  | {
      readonly name: string;
      readonly version: string;
      readonly build_id: string;
      readonly built_at: number;
      readonly source_stamp: number;
      readonly mode: string;
    }
  | undefined;

export const PLUGIN_BUILD_INFO = __REMNOTE_PLUGIN_BUILD_INFO__ ?? {
  name: '@remnote/plugin',
  version: '0.0.0',
  build_id: '0.0.0:unknown',
  built_at: 0,
  source_stamp: 0,
  mode: 'unknown',
};
