CREATE TABLE connection_folder (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, parentId INTEGER);
CREATE TABLE saved_connection (
  id INTEGER PRIMARY KEY,
  name VARCHAR,
  connectionType VARCHAR,
  host VARCHAR,
  port INTEGER,
  username VARCHAR,
  domain VARCHAR,
  defaultDatabase VARCHAR,
  socketPath VARCHAR,
  socketPathEnabled BOOLEAN DEFAULT 0,
  ssl BOOLEAN DEFAULT 0,
  sslCaFile VARCHAR,
  sslCertFile VARCHAR,
  sslKeyFile VARCHAR,
  sslRejectUnauthorized BOOLEAN DEFAULT 1,
  trustServerCertificate BOOLEAN DEFAULT 0,
  windowsAuthEnabled BOOLEAN DEFAULT 0,
  azureAuthOptions VARCHAR DEFAULT '{}',
  sshEnabled BOOLEAN DEFAULT 0,
  sshMode VARCHAR DEFAULT 'agent',
  sshHost VARCHAR,
  sshPort INTEGER,
  sshUsername VARCHAR,
  sshKeyfile VARCHAR,
  sshBastionHost VARCHAR,
  readOnlyMode BOOLEAN DEFAULT 0,
  labelColor VARCHAR DEFAULT 'default',
  connectionFolderId INTEGER,
  password VARCHAR,
  sshPassword VARCHAR,
  sshKeyfilePassword VARCHAR
);
INSERT INTO connection_folder (id, name, parentId) VALUES (1, 'Work', NULL), (2, 'Databases', 1);
INSERT INTO saved_connection (id, name, connectionType, host, port, username, defaultDatabase, ssl, sshEnabled, sshMode, sshHost, sshPort, sshUsername, sshKeyfile, sshBastionHost, labelColor, connectionFolderId, readOnlyMode)
  VALUES (1, 'PG via key', 'postgresql', 'pg.example.com', 5432, 'bkuser', 'shop', 1, 1, 'keyfile', 'jump.example.com', 22, 'ssh-user', '/home/u/.ssh/id_ed25519', 'bastion.example.com', 'green', 2, 1);
INSERT INTO saved_connection (id, name, connectionType, host, port, username, windowsAuthEnabled, domain)
  VALUES (2, 'SQL Server Windows', 'sqlserver', 'sql.example.com', 1433, 'svc', 1, 'CORP');
INSERT INTO saved_connection (id, name, connectionType, defaultDatabase) VALUES (3, 'Local file', 'sqlite', '/data/local.db');
INSERT INTO saved_connection (id, name, connectionType, host) VALUES (4, 'Redshift', 'redshift', 'rs.example.com');
