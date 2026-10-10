/** Offline structural validation; full CloudFormation/SAM validation requires SAM CLI. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const template = JSON.parse(await readFile('infra/template.json', 'utf8'));
assert.equal(template.Transform, 'AWS::Serverless-2016-10-31');
const resources = new Set(Object.keys(template.Resources));
const knownRefs = new Set([...resources, ...Object.keys(template.Parameters), 'AWS::Region', 'AWS::AccountId', 'AWS::StackName', 'AWS::Partition', 'AWS::NoValue']);
function walk(value) {
  if (!value || typeof value !== 'object') return;
  if ('Ref' in value) assert(knownRefs.has(value.Ref), `Unknown Ref ${value.Ref}`);
  if ('Fn::GetAtt' in value) assert(resources.has(value['Fn::GetAtt'][0]), `Unknown GetAtt ${value['Fn::GetAtt']}`);
  for (const entry of Object.values(value)) walk(entry);
}
walk(template);
assert.equal(template.Resources.ApiCache.Properties.CachePolicyConfig.MaxTTL, 0);
const apiCache = template.Resources.ApiCache.Properties.CachePolicyConfig;
assert.equal(apiCache.MinTTL, 0);
assert.equal(apiCache.DefaultTTL, 0);
assert.equal(apiCache.ParametersInCacheKeyAndForwardedToOrigin.EnableAcceptEncodingGzip, false);
assert.equal(apiCache.ParametersInCacheKeyAndForwardedToOrigin.EnableAcceptEncodingBrotli, false);
assert.equal(template.Resources.ReportsTable.DeletionPolicy, 'Retain');
assert.equal(template.Parameters.SessionSecret.NoEcho, true);
assert.equal(template.Resources.ApiFunction.Properties.Runtime, 'nodejs24.x');
console.log(`Infrastructure JSON and references passed (${resources.size} resources). Full SAM/provider validation still required before deployment.`);
