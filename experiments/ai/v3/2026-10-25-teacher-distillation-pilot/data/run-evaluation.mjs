import {runStudyCommand} from '../../study-commands.mjs';
const d='tools/ai-gnn/target/teacher-distillation-pilot';
await runStudyCommand(d,'student-browser-validation',process.execPath,['tools/ai-gnn/test-browser.mjs','--model',d+'/student-teacher4096','--wasm','experiments/ai/v3/2026-10-25-teacher-budget-4096/data/sh8.wasm','--output',d+'/student-browser-validation.json']);
await runStudyCommand(d,'strength-stages',process.execPath,[d+'/run-strength.mjs']);
