-- Runs once, when the local database volume is created.
-- pm_dev: `npm run dev` · pm_test: Go tests · pm_e2e / pm_e2e_ro: end-to-end tests
create database pm_test owner pm;
create database pm_e2e owner pm;
create database pm_e2e_ro owner pm;
