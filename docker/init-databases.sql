-- Runs once, when the local database volume is created.
-- pm_dev: `npm run dev` · pm_test: Go tests · pm_e2e: end-to-end tests
create database pm_test owner pm;
create database pm_e2e owner pm;

-- pgvector, for search by meaning (PM_EMBEDDINGS). The server creates it itself when it may;
-- creating it here keeps the tests from racing to do it.
\c pm_dev
create extension if not exists vector;
\c pm_test
create extension if not exists vector;
\c pm_e2e
create extension if not exists vector;
