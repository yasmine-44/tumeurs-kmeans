"""Accès SQLite : création du schéma, import du CSV, lecture du jeu de données."""
import csv
import sqlite3
import sys
from pathlib import Path

import numpy as np

BASE = Path(__file__).parent
DB_PATH = BASE / "data" / "tumeurs.db"
CSV_PATH = BASE / "data" / "wdbc_mean.csv"
SCHEMA_PATH = BASE / "schema.sql"

# (clé SQL, libellé, description) — les 10 mesures « moyennes » du jeu Wisconsin Diagnostic
FEATURES = [
    ("radius", "Rayon", "Distance moyenne du centre du noyau cellulaire à son contour"),
    ("texture", "Texture", "Écart-type des niveaux de gris : hétérogénéité du noyau"),
    ("perimeter", "Périmètre", "Longueur du contour du noyau"),
    ("area", "Aire", "Surface du noyau"),
    ("smoothness", "Régularité", "Variation locale de la longueur des rayons"),
    ("compactness", "Compacité", "Périmètre² / aire − 1 : à quel point la forme est « tassée »"),
    ("concavity", "Concavité", "Gravité des creux du contour"),
    ("concave_points", "Points concaves", "Nombre de creux sur le contour"),
    ("symmetry", "Symétrie", "Symétrie de la forme du noyau"),
    ("fractal_dimension", "Dimension fractale", "Rugosité du contour (approximation de la côte)"),
]
KEYS = [f[0] for f in FEATURES]


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(reset=False):
    DB_PATH.parent.mkdir(exist_ok=True)
    if reset and DB_PATH.exists():
        DB_PATH.unlink()
    with connect() as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        if conn.execute("SELECT COUNT(*) FROM tumeurs").fetchone()[0] == 0:
            with open(CSV_PATH, newline="", encoding="utf-8") as f:
                rows = [(int(r["id"]), r["diagnostic"], *[float(r[k]) for k in KEYS])
                        for r in csv.DictReader(f)]
            conn.executemany(
                f"INSERT INTO tumeurs (id, diagnostic, {', '.join(KEYS)}) "
                f"VALUES (?, ?, {', '.join('?' * len(KEYS))})", rows)


def load_dataset():
    """Retourne (ids, X, y) avec y = 1 pour malin, 0 pour bénin."""
    with connect() as conn:
        rows = conn.execute(f"SELECT id, diagnostic, {', '.join(KEYS)} FROM tumeurs ORDER BY id").fetchall()
    ids = np.array([r["id"] for r in rows])
    y = np.array([1 if r["diagnostic"] == "M" else 0 for r in rows])
    X = np.array([[r[k] for k in KEYS] for r in rows], dtype=float)
    return ids, X, y


if __name__ == "__main__":
    init_db(reset="--reset" in sys.argv)
    print(f"Base prête : {DB_PATH}")
