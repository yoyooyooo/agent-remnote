import { remnoteCommandInventory } from './commandInventory.js';
import { assertKnownModeParityRequirements, modeParityRequirementIds, type ModeParityRequirementId } from './capabilityGuards.js';

export { modeParityRequirementIds } from './capabilityGuards.js';

export type Wave1CommandContract = {
  readonly command_id: string;
  readonly family: string;
  readonly parity_target: 'same_support' | 'same_stable_failure';
  readonly required_capabilities: readonly ModeParityRequirementId[];
  readonly local_use_case: string;
  readonly remote_endpoint: string;
  readonly success_normalizer: string;
  readonly stable_failure_normalizer: string;
  readonly verification_case_ids: readonly string[];
};

type ContractSeed = Omit<Wave1CommandContract, 'command_id' | 'family' | 'parity_target'>;

const wave1Inventory = remnoteCommandInventory.filter(
  (command) => command.classification === 'business' && command.wave === 'wave1',
) as ReadonlyArray<
  (typeof remnoteCommandInventory)[number] & {
    readonly classification: 'business';
    readonly wave: 'wave1';
    readonly parityTarget: 'same_support' | 'same_stable_failure';
  }
>;

const contractSeeds: Record<string, ContractSeed> = {
  search: {
    required_capabilities: ['search.db'],
    local_use_case: 'executeDbSearchUseCase',
    remote_endpoint: '/search/db',
    success_normalizer: 'normalize.search',
    stable_failure_normalizer: 'normalize.search.failure',
    verification_case_ids: ['search.success.basic', 'search.failure.stable'],
  },
  'rem.outline': {
    required_capabilities: ['read.outline'],
    local_use_case: 'executeReadOutlineUseCase',
    remote_endpoint: '/read/outline',
    success_normalizer: 'normalize.outline',
    stable_failure_normalizer: 'normalize.outline.failure',
    verification_case_ids: ['rem.outline.success.basic', 'rem.outline.failure.stable'],
  },
  'daily.rem-id': {
    required_capabilities: ['daily.rem-id'],
    local_use_case: 'executeDailyRemIdUseCase',
    remote_endpoint: '/daily/rem-id',
    success_normalizer: 'normalize.dailyRemId',
    stable_failure_normalizer: 'normalize.dailyRemId.failure',
    verification_case_ids: ['daily.rem-id.success.basic', 'daily.rem-id.failure.stable'],
  },
  'page-id': {
    required_capabilities: ['read.page-id'],
    local_use_case: 'executeReadPageIdUseCase',
    remote_endpoint: '/read/page-id',
    success_normalizer: 'normalize.pageId',
    stable_failure_normalizer: 'normalize.pageId.failure',
    verification_case_ids: ['page-id.success.basic', 'page-id.failure.stable'],
  },
  'by-reference': {
    required_capabilities: ['read.by-reference'],
    local_use_case: 'executeReadByReferenceUseCase',
    remote_endpoint: '/read/by-reference',
    success_normalizer: 'normalize.byReference',
    stable_failure_normalizer: 'normalize.byReference.failure',
    verification_case_ids: ['by-reference.success.basic', 'by-reference.failure.stable'],
  },
  references: {
    required_capabilities: ['read.references'],
    local_use_case: 'executeReadReferencesUseCase',
    remote_endpoint: '/read/references',
    success_normalizer: 'normalize.references',
    stable_failure_normalizer: 'normalize.references.failure',
    verification_case_ids: ['references.success.basic', 'references.failure.stable'],
  },
  'resolve-ref': {
    required_capabilities: ['read.resolve-ref'],
    local_use_case: 'executeResolveRefUseCase',
    remote_endpoint: '/read/resolve-ref',
    success_normalizer: 'normalize.resolveRef',
    stable_failure_normalizer: 'normalize.resolveRef.failure',
    verification_case_ids: ['resolve-ref.success.basic', 'resolve-ref.failure.stable'],
  },
  query: {
    required_capabilities: ['read.query'],
    local_use_case: 'executeReadQueryUseCase',
    remote_endpoint: '/read/query',
    success_normalizer: 'normalize.query',
    stable_failure_normalizer: 'normalize.query.failure',
    verification_case_ids: ['query.success.basic', 'query.failure.stable'],
  },
  'plugin.current': {
    required_capabilities: ['plugin.current'],
    local_use_case: 'collectPluginCurrentUseCase',
    remote_endpoint: '/plugin/current',
    success_normalizer: 'normalize.pluginCurrent',
    stable_failure_normalizer: 'normalize.pluginCurrent.failure',
    verification_case_ids: ['plugin.current.success.basic', 'plugin.current.failure.stable'],
  },
  'plugin.search': {
    required_capabilities: ['search.plugin'],
    local_use_case: 'executePluginSearchUseCase',
    remote_endpoint: '/search/plugin',
    success_normalizer: 'normalize.pluginSearch',
    stable_failure_normalizer: 'normalize.pluginSearch.failure',
    verification_case_ids: ['plugin.search.success.basic', 'plugin.search.failure.stable'],
  },
  'plugin.ui-context.snapshot': {
    required_capabilities: ['ui-context.snapshot'],
    local_use_case: 'collectUiContextSnapshotUseCase',
    remote_endpoint: '/plugin/ui-context/snapshot',
    success_normalizer: 'normalize.uiContextSnapshot',
    stable_failure_normalizer: 'normalize.uiContextSnapshot.failure',
    verification_case_ids: ['plugin.ui-context.snapshot.success.basic'],
  },
  'plugin.ui-context.page': {
    required_capabilities: ['ui-context.page'],
    local_use_case: 'collectUiContextPageUseCase',
    remote_endpoint: '/plugin/ui-context/page',
    success_normalizer: 'normalize.uiContextPage',
    stable_failure_normalizer: 'normalize.uiContextPage.failure',
    verification_case_ids: ['plugin.ui-context.page.success.basic', 'plugin.ui-context.page.failure.stable'],
  },
  'plugin.ui-context.focused-rem': {
    required_capabilities: ['ui-context.focused-rem'],
    local_use_case: 'collectUiContextFocusedRemUseCase',
    remote_endpoint: '/plugin/ui-context/focused-rem',
    success_normalizer: 'normalize.uiContextFocusedRem',
    stable_failure_normalizer: 'normalize.uiContextFocusedRem.failure',
    verification_case_ids: ['plugin.ui-context.focused-rem.success.basic', 'plugin.ui-context.focused-rem.failure.stable'],
  },
  'plugin.ui-context.describe': {
    required_capabilities: ['ui-context.describe'],
    local_use_case: 'collectUiContextDescribeUseCase',
    remote_endpoint: '/plugin/ui-context/describe',
    success_normalizer: 'normalize.uiContextDescribe',
    stable_failure_normalizer: 'normalize.uiContextDescribe.failure',
    verification_case_ids: ['plugin.ui-context.describe.success.basic', 'plugin.ui-context.describe.failure.stable'],
  },
  'plugin.selection.current': {
    required_capabilities: ['selection.current'],
    local_use_case: 'collectSelectionCurrentUseCase',
    remote_endpoint: '/plugin/selection/current',
    success_normalizer: 'normalize.selectionCurrent',
    stable_failure_normalizer: 'normalize.selectionCurrent.failure',
    verification_case_ids: ['plugin.selection.current.success.basic', 'plugin.selection.current.failure.stable'],
  },
  'plugin.selection.snapshot': {
    required_capabilities: ['selection.snapshot'],
    local_use_case: 'collectSelectionSnapshotUseCase',
    remote_endpoint: '/plugin/selection/snapshot',
    success_normalizer: 'normalize.selectionSnapshot',
    stable_failure_normalizer: 'normalize.selectionSnapshot.failure',
    verification_case_ids: ['plugin.selection.snapshot.success.basic'],
  },
  'plugin.selection.roots': {
    required_capabilities: ['selection.roots'],
    local_use_case: 'collectSelectionRootsUseCase',
    remote_endpoint: '/plugin/selection/roots',
    success_normalizer: 'normalize.selectionRoots',
    stable_failure_normalizer: 'normalize.selectionRoots.failure',
    verification_case_ids: ['plugin.selection.roots.success.basic', 'plugin.selection.roots.failure.stable'],
  },
  'plugin.selection.outline': {
    required_capabilities: ['selection.outline'],
    local_use_case: 'collectSelectionOutlineUseCase',
    remote_endpoint: '/plugin/selection/outline',
    success_normalizer: 'normalize.selectionOutline',
    stable_failure_normalizer: 'normalize.selectionOutline.failure',
    verification_case_ids: ['plugin.selection.outline.success.basic', 'plugin.selection.outline.failure.stable'],
  },
  'daily.write': {
    required_capabilities: ['write.apply', 'receipt.enrichment'],
    local_use_case: 'executeWriteApplyUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.dailyWrite',
    stable_failure_normalizer: 'normalize.dailyWrite.failure',
    verification_case_ids: ['daily.write.success.basic', 'daily.write.failure.stable'],
  },
  apply: {
    required_capabilities: ['write.apply'],
    local_use_case: 'executeWriteApplyUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.apply',
    stable_failure_normalizer: 'normalize.apply.failure',
    verification_case_ids: ['apply.success.basic', 'apply.failure.stable'],
  },
  'queue.wait': {
    required_capabilities: ['queue.wait'],
    local_use_case: 'waitForTxn',
    remote_endpoint: '/queue/wait',
    success_normalizer: 'normalize.queueWait',
    stable_failure_normalizer: 'normalize.queueWait.failure',
    verification_case_ids: ['queue.wait.success.basic', 'queue.wait.failure.stable'],
  },
  'rem.create': {
    required_capabilities: ['write.apply', 'resolve.ref', 'resolve.placement', 'title.inference', 'receipt.enrichment'],
    local_use_case: 'executeRemCreateUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.remCreate',
    stable_failure_normalizer: 'normalize.remCreate.failure',
    verification_case_ids: ['rem.create.success.basic', 'rem.create.failure.stable'],
  },
  'rem.move': {
    required_capabilities: ['write.apply', 'resolve.ref', 'resolve.placement', 'receipt.enrichment'],
    local_use_case: 'executeRemMoveUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.remMove',
    stable_failure_normalizer: 'normalize.remMove.failure',
    verification_case_ids: ['rem.move.success.basic', 'rem.move.failure.stable'],
  },
  'portal.create': {
    required_capabilities: ['write.apply', 'resolve.ref', 'resolve.placement', 'receipt.enrichment'],
    local_use_case: 'executePortalCreateUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.portalCreate',
    stable_failure_normalizer: 'normalize.portalCreate.failure',
    verification_case_ids: ['portal.create.success.basic', 'portal.create.failure.stable'],
  },
  'rem.replace': {
    required_capabilities: ['write.apply', 'resolve.ref', 'selection.current', 'receipt.enrichment'],
    local_use_case: 'executeRemReplaceUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.remReplace',
    stable_failure_normalizer: 'normalize.remReplace.failure',
    verification_case_ids: ['rem.replace.success.basic', 'rem.replace.failure.stable'],
  },
  'rem.children.append': {
    required_capabilities: ['write.apply', 'resolve.ref', 'selection.current', 'receipt.enrichment'],
    local_use_case: 'executeRemChildrenAppendUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.remChildrenAppend',
    stable_failure_normalizer: 'normalize.remChildrenAppend.failure',
    verification_case_ids: ['rem.children.append.success.basic', 'rem.children.append.failure.stable'],
  },
  'rem.children.prepend': {
    required_capabilities: ['write.apply', 'resolve.ref', 'selection.current', 'receipt.enrichment'],
    local_use_case: 'executeRemChildrenPrependUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.remChildrenPrepend',
    stable_failure_normalizer: 'normalize.remChildrenPrepend.failure',
    verification_case_ids: ['rem.children.prepend.success.basic', 'rem.children.prepend.failure.stable'],
  },
  'rem.children.clear': {
    required_capabilities: ['write.apply', 'resolve.ref', 'selection.current', 'receipt.enrichment'],
    local_use_case: 'executeRemChildrenClearUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.remChildrenClear',
    stable_failure_normalizer: 'normalize.remChildrenClear.failure',
    verification_case_ids: ['rem.children.clear.success.basic', 'rem.children.clear.failure.stable'],
  },
  'rem.children.replace': {
    required_capabilities: ['write.apply', 'resolve.ref', 'selection.current', 'receipt.enrichment'],
    local_use_case: 'executeRemChildrenReplaceUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.remChildrenReplace',
    stable_failure_normalizer: 'normalize.remChildrenReplace.failure',
    verification_case_ids: ['rem.children.replace.success.basic', 'rem.children.replace.failure.stable'],
  },
  'rem.set-text': {
    required_capabilities: ['write.apply', 'resolve.ref'],
    local_use_case: 'executeRemSetTextUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.remSetText',
    stable_failure_normalizer: 'normalize.remSetText.failure',
    verification_case_ids: ['rem.set-text.success.basic', 'rem.set-text.failure.stable'],
  },
  'rem.delete': {
    required_capabilities: ['write.apply', 'resolve.ref', 'receipt.enrichment'],
    local_use_case: 'executeRemDeleteUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.remDelete',
    stable_failure_normalizer: 'normalize.remDelete.failure',
    verification_case_ids: ['rem.delete.success.basic', 'rem.delete.failure.stable'],
  },
  'tag.add': {
    required_capabilities: ['write.apply', 'resolve.ref'],
    local_use_case: 'executeTagAddUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.tagAdd',
    stable_failure_normalizer: 'normalize.tagAdd.failure',
    verification_case_ids: ['tag.add.success.basic', 'tag.add.failure.stable'],
  },
  'tag.remove': {
    required_capabilities: ['write.apply', 'resolve.ref'],
    local_use_case: 'executeTagRemoveUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.tagRemove',
    stable_failure_normalizer: 'normalize.tagRemove.failure',
    verification_case_ids: ['tag.remove.success.basic', 'tag.remove.failure.stable'],
  },
  'rem.tag.add': {
    required_capabilities: ['write.apply', 'resolve.ref'],
    local_use_case: 'executeTagAddUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.remTagAdd',
    stable_failure_normalizer: 'normalize.remTagAdd.failure',
    verification_case_ids: ['rem.tag.add.success.basic', 'rem.tag.add.failure.stable'],
  },
  'rem.tag.remove': {
    required_capabilities: ['write.apply', 'resolve.ref'],
    local_use_case: 'executeTagRemoveUseCase',
    remote_endpoint: '/write/apply',
    success_normalizer: 'normalize.remTagRemove',
    stable_failure_normalizer: 'normalize.remTagRemove.failure',
    verification_case_ids: ['rem.tag.remove.success.basic', 'rem.tag.remove.failure.stable'],
  },
};

function readContractSeed(commandId: string): ContractSeed {
  const seed = contractSeeds[commandId];
  if (!seed) {
    throw new Error(`Missing Wave 1 command contract seed: ${commandId}`);
  }
  assertKnownModeParityRequirements(seed.required_capabilities);
  return seed;
}

export const wave1CommandContracts: readonly Wave1CommandContract[] = wave1Inventory.map((command) => {
  const seed = readContractSeed(command.id);
  return {
    command_id: command.id,
    family: command.family,
    parity_target: command.parityTarget,
    ...seed,
  };
});

export const wave1CommandContractIds = wave1CommandContracts.map((command) => command.command_id);

void modeParityRequirementIds;
