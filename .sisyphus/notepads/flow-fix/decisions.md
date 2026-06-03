# Decisions

## Removal of POST /installations Stub Endpoint

### Context
The `POST /installations` endpoint in `src/installations/installations.controller.ts` was a stub that only validated the request body and returned the parsed DTO without persisting anything to MongoDB. This caused issues where clients (like `proof.html` and Postman) assumed the installation was successfully created and persisted, when in reality it was not.

### Decision
We removed the broken `POST /installations` stub endpoint. The canonical flow for creating and activating installations is:
1. `POST /permissions/prepare` to create a `pending_permission` installation and compile the `PermissionManifest` and `walletRequest`.
2. User signs the request in their wallet.
3. `POST /permissions/grant` to submit the signed grant, create the delegation record, and activate the installation.

### Impact
- The Postman collection has been updated to replace the "Create installation (DCA on Base)" entry with "Prepare permission request (DCA on Base)" and add a "Submit permission grant" entry right after it.
- The `proof.html` page is being updated in parallel to follow this canonical flow.
- The backend codebase is now cleaner and adheres to the "no mock endpoints, no fake success" constraint.
