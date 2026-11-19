-- Base de données SQLite du projet (créée automatiquement au premier lancement)

CREATE TABLE IF NOT EXISTS tumeurs (
    id                INTEGER PRIMARY KEY,
    diagnostic        TEXT NOT NULL CHECK (diagnostic IN ('B', 'M')),   -- B = bénin, M = malin
    radius            REAL NOT NULL,
    texture           REAL NOT NULL,
    perimeter         REAL NOT NULL,
    area              REAL NOT NULL,
    smoothness        REAL NOT NULL,
    compactness       REAL NOT NULL,
    concavity         REAL NOT NULL,
    concave_points    REAL NOT NULL,
    symmetry          REAL NOT NULL,
    fractal_dimension REAL NOT NULL
);

-- Historique des clusterings lancés depuis le site
CREATE TABLE IF NOT EXISTS analyses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    k          INTEGER NOT NULL,
    features   TEXT NOT NULL,          -- liste JSON des variables utilisées
    inertia    REAL NOT NULL,
    silhouette REAL NOT NULL,
    purity     REAL NOT NULL,
    ari        REAL NOT NULL,
    n_iter     INTEGER NOT NULL
);

-- Historique des profils saisis dans le formulaire « Placer une tumeur »
CREATE TABLE IF NOT EXISTS predictions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    k          INTEGER NOT NULL,
    features   TEXT NOT NULL,
    valeurs    TEXT NOT NULL,          -- JSON {variable: valeur}
    cluster    INTEGER NOT NULL,
    pct_malin  REAL NOT NULL
);
