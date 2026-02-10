import { inspect } from 'util';

import { z } from 'zod';

import { notifyStartSync } from '../packages/agent-remnote/src/internal/ws-bridge/bridge.ts';

import { executeSearchRemOverview, searchRemOverviewSchema } from '../packages/agent-remnote/src/internal/remdb-tools/searchRemOverview.ts';
import { executeInspectRemDoc, inspectRemDocSchema } from '../packages/agent-remnote/src/internal/remdb-tools/inspectRemDoc.ts';
import { executeOutlineRemSubtree, outlineRemSubtreeSchema } from '../packages/agent-remnote/src/internal/remdb-tools/outlineRemSubtree.ts';
import { executeResolveRemReference, resolveRemReferenceSchema } from '../packages/agent-remnote/src/internal/remdb-tools/resolveRemReference.ts';
import { executeListRemBackups, listRemBackupsSchema } from '../packages/agent-remnote/src/internal/remdb-tools/listRemBackups.ts';
import { executeSummarizeDailyNotes, summarizeDailyNotesSchema } from '../packages/agent-remnote/src/internal/remdb-tools/summarizeDailyNotes.ts';
import { executeSummarizeTopicActivity, summarizeTopicActivitySchema } from '../packages/agent-remnote/src/internal/remdb-tools/summarizeTopicActivity.ts';
import { executeReadRemTable, readRemTableSchema } from '../packages/agent-remnote/src/internal/remdb-tools/readRemTable.ts';
import { executeFindRemsByReference, findRemsByReferenceSchema } from '../packages/agent-remnote/src/internal/remdb-tools/findRemsByReference.ts';
import { executeListRemReferences, listRemReferencesSchema } from '../packages/agent-remnote/src/internal/remdb-tools/listRemReferences.ts';
import { executeGetRemConnections, getRemConnectionsSchema } from '../packages/agent-remnote/src/internal/remdb-tools/getRemConnections.ts';
import { executeSearchQuery, executeSearchQuerySchema } from '../packages/agent-remnote/src/internal/remdb-tools/executeSearchQuery.ts';
import { executeResolveRemPage, resolveRemPageSchema } from '../packages/agent-remnote/src/internal/remdb-tools/resolveRemPage.ts';
import { executeListTodos, listTodosSchema } from '../packages/agent-remnote/src/internal/remdb-tools/listTodos.ts';
import { TYPES } from '../packages/agent-remnote/src/internal/remdb-tools/listSupportedOps.ts';

const tool = process.argv[2];
const payload = process.argv[3];

if (!tool) {
  console.error("Usage: bunx tsx scripts/run-tool.ts <tool_name> '<json args>'");
  process.exit(1);
}

const registry = {
  search_rem_overview: {
    schema: searchRemOverviewSchema,
    exec: executeSearchRemOverview,
  },
  list_supported_ops: {
    schema: z.object({}),
    exec: async (_args: any) => {
      const types = Object.keys(TYPES || {});
      const payloadSchemas = TYPES || {};
      return { types, payloadSchemas };
    },
  },
  inspect_rem_doc: {
    schema: inspectRemDocSchema,
    exec: executeInspectRemDoc,
  },
  outline_rem_subtree: {
    schema: outlineRemSubtreeSchema,
    exec: executeOutlineRemSubtree,
  },
  resolve_rem_reference: {
    schema: resolveRemReferenceSchema,
    exec: executeResolveRemReference,
  },
  resolve_rem_page: {
    schema: resolveRemPageSchema,
    exec: executeResolveRemPage,
  },
  list_rem_backups: {
    schema: listRemBackupsSchema,
    exec: executeListRemBackups,
  },
  summarize_daily_notes: {
    schema: summarizeDailyNotesSchema,
    exec: executeSummarizeDailyNotes,
  },
  summarize_topic_activity: {
    schema: summarizeTopicActivitySchema,
    exec: executeSummarizeTopicActivity,
  },
  find_rems_by_reference: {
    schema: findRemsByReferenceSchema,
    exec: executeFindRemsByReference,
  },
  list_rem_references: {
    schema: listRemReferencesSchema,
    exec: async (args: any) => {
      const { payload } = await executeListRemReferences(args);
      return payload;
    },
  },
  get_rem_connections: {
    schema: getRemConnectionsSchema,
    exec: executeGetRemConnections,
  },
  read_table_rem: {
    schema: readRemTableSchema,
    exec: executeReadRemTable,
  },
  execute_search_query: {
    schema: executeSearchQuerySchema,
    exec: async (args: any) => {
      const { payload } = await executeSearchQuery(args);
      return payload;
    },
  },
  list_todos: {
    schema: listTodosSchema,
    exec: async (args: any) => {
      const result = await executeListTodos(args);
      return result;
    },
  },
  ws_start_sync: {
    schema: z.object({}),
    exec: async (args: any) => {
      const res = notifyStartSync();
      return res;
    },
  },
} as const;

type Registry = typeof registry

if (!(tool in registry)) {
  console.error(`Unknown tool: ${tool}`);
  process.exit(1);
}

const entry = registry[tool as keyof Registry];

let rawArgs: unknown;
try {
  rawArgs = payload ? JSON.parse(payload) : {};
} catch (error) {
  console.error('Failed to parse JSON args:', error);
  process.exit(1);
}

async function run() {
  const args = entry.schema.parse(rawArgs);
  const result = await entry.exec(args as never);
  const asJson = process.env.PRINT_JSON === '1';
  if (asJson) {
    const payload = (result as any)?.structuredContent ?? result;
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(inspect(result, { depth: null, colors: true }));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
