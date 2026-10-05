// Pure schema check shared with the generated service worker.
export function validPublicHistory(value, name, lawSources) {
  const sources = [...lawSources, { id: 'state-organizations', sourceUrl: 'https://forum.russia.online/threads/pravila-gosudarstvennykh-organizatsii.11/' }];
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const revision = value => {
    const source = sources.find(source => source.id === value?.document);
    return !!source && value.sourceUrl === source.sourceUrl && typeof value.id === 'string' && new RegExp('^' + value.document + '-[a-f0-9]{24}$').test(value.id) &&
      typeof value.title === 'string' && Number.isFinite(Date.parse(value.detectedAt)) && (value.sourceEditedAt === null || Number.isFinite(Date.parse(value.sourceEditedAt))) &&
      hash(value.beforeHash) && hash(value.afterHash) && [value.added,value.changed,value.removed].every(count => Number.isInteger(count) && count >= 0 && count <= 5000) && value.added + value.changed + value.removed > 0;
  };
  if (name === 'index.json') return value?.version === 1 && Number.isFinite(Date.parse(value.startedAt)) && Array.isArray(value.documents) && value.documents.length === sources.length &&
    new Set(value.documents.map(doc => doc?.id)).size === sources.length && value.documents.every(doc => sources.some(source => source.id === doc?.id && source.sourceUrl === doc.sourceUrl) && typeof doc.title === 'string' && hash(doc.baselineHash)) &&
    Array.isArray(value.revisions) && new Set(value.revisions.map(row => row?.id)).size === value.revisions.length && value.revisions.every(revision);
  const entry = item => item === null || !!item && typeof item.id === 'string' && ['article','section','introduction'].includes(item.kind) && typeof item.title === 'string' && typeof item.chapter === 'string' && Array.isArray(item.paragraphs) && item.paragraphs.every(text => typeof text === 'string');
  return revision(value) && value.id + '.json' === name && Array.isArray(value.changes) && value.changes.length === value.added + value.changed + value.removed &&
    new Set(value.changes.map(change => change?.id)).size === value.changes.length && value.changes.every(change => !!change && entry(change.before) && entry(change.after) && (change.before === null || change.before.id === change.id) && (change.after === null || change.after.id === change.id) &&
      (change.type === 'added' ? change.before === null && change.after !== null : change.type === 'removed' ? change.before !== null && change.after === null : change.type === 'changed' && change.before !== null && change.after !== null));
}
