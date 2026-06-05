DROP TABLE IF EXISTS build_logs CASCADE;
DROP TABLE IF EXISTS builds CASCADE;
DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS repositories CASCADE;

CREATE TABLE repositories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    github_url TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE builds (
    id SERIAL PRIMARY KEY,

    repository_id INT NOT NULL,

    commit_hash VARCHAR(100),

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN (
            'PENDING',
            'RUNNING',
            'SUCCESS',
            'FAILED'
        )),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,

    FOREIGN KEY (repository_id)
        REFERENCES repositories(id)
        ON DELETE CASCADE
);

CREATE TABLE build_logs (
    id SERIAL PRIMARY KEY,

    build_id INT NOT NULL,

    log_message TEXT NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (build_id)
        REFERENCES builds(id)
        ON DELETE CASCADE
);

CREATE TABLE webhook_events (
    id SERIAL PRIMARY KEY,

    repository_id INT,

    event_type VARCHAR(100) NOT NULL,

    payload JSONB NOT NULL,

    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (repository_id)
        REFERENCES repositories(id)
        ON DELETE SET NULL
);

CREATE INDEX idx_builds_repository_id
ON builds(repository_id);

CREATE INDEX idx_builds_status
ON builds(status);

CREATE INDEX idx_build_logs_build_id
ON build_logs(build_id);

CREATE INDEX idx_webhook_repository_id
ON webhook_events(repository_id);