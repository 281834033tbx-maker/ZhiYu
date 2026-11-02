// Production-chain offline regression. Superseded gate test is in the dated backup.
if(process.argv.includes('--live'))throw Error('This regression entry point is offline only');
await import('./verify-dialogue-pipeline-20261005.mjs');
