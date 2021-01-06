# µlambda

Is an opinionated framework that simplifies development of typescript serverless microservices
architectures.

The project is maintained as a monorepo (using yarn workspaces) and contains the following packages:

* `@microlambda/core` Core package that contains all low-level logic to run microlambda projects.
* `@microlambda/cli` A command line interface that provides tooling to generate, run, test and deploy projects.
* `@microlambda/generator` A command line interface that provides tooling to generate, run, test and deploy projects.
* `@microlambda/client` The web UI to monitor and interact with the microservices during local runs.
* `@microlambda/server` The WebSocket server that send data to client and handle its requests.
* `@microlambda/handling` Helpers that automates repetitive tasks such as CORS configuration, build responses.
* `@microlambda/testing` Tests helpers for easy functional tests setup. 
* `@microlambda/plugin` Serverless framework plugin that enable custom domain creation and multi-regions deployments. 
* `@microlambda/docs` Project documentation website. Powered by docusaurus.

## Getting started

1. Clone this repo
2. Install dependencies `yarn`
