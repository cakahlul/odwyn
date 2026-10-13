# Tere Reports connector review — Phase 1

Only installed tool metadata was inspected. No live report request, API key, company data or paid operation was used.

The installed connector exposes bug reports with required boardId, sprint/epic reports with required projectId, and tools with optional project/team scopes or aggregate dashboard access. Its owner API key inherits the creator's access. These input filters alone are not agent authorization or credential isolation. This connector does not expose repository reads and cannot satisfy AUTH-004.

Odwyn must register each permitted board/project/team as an exact owner resource, validate reviewed tool arguments server-side against the immutable agent/Space/task identity, and keep upstream credentials inside the Phase 3 broker. Aggregate or optional-scope calls stay unavailable until explicit bounded authority exists. Connector availability inside Codex does not grant Odwyn agents access; no provider, agent name or interaction mode confers authority.

Phase 1 uses disposable scoped HTTP repositories and a real MCP SDK client/server to prove native/MCP read enforcement without live systems. Tere Reports integration remains deferred to Phase 3; no raw token was copied into repository configuration or a worker.
