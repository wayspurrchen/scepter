// Claim address parser
export {
  parseClaimAddress,
  parseClaimReferences,
  parseRangeSuffix,
  expandClaimRange,
  normalizeSectionSymbol,
  parseMetadataSuffix,
} from './claim-parser';

export type {
  ClaimAddress,
  ClaimParseOptions,
  ClaimReference,
} from './claim-parser';

// Claim tree builder
export {
  buildClaimTree,
  validateClaimTree,
} from './claim-tree';

export type {
  ClaimNode,
  ClaimTreeResult,
  ClaimTreeError,
} from './claim-tree';
