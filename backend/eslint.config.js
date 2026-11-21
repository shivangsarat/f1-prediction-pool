import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Use TypeScript-aware rules while keeping legacy financial DTO typing migration incremental. */
export default tseslint.config(
  {ignores:['node_modules/**','coverage/**']},
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {rules:{'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':'off','@typescript-eslint/no-require-imports':'off'}}
);
