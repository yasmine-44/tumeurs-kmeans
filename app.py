"""Site web « Profils tumoraux par K-means » — backend Flask."""
import json

import numpy as np
from flask import Flask, jsonify, render_template, request

import analysis
import database as db

app = Flask(__name__)
db.init_db()

IDS, X, Y = db.load_dataset()
LABELS = {k: lab for k, lab, _ in db.FEATURES}
_models = {}


class BadRequest(Exception):
    pass


@app.errorhandler(BadRequest)
def bad_request(e):
    return jsonify(error=str(e)), 400


def parse_params(data):
    keys = data.get("features") or db.KEYS
    if not isinstance(keys, list) or any(k not in db.KEYS for k in keys):
        raise BadRequest("Variable inconnue.")
    keys = [k for k in db.KEYS if k in set(keys)]  # ordre canonique, sans doublon
    if len(keys) < 2:
        raise BadRequest("Choisissez au moins 2 variables.")
    # Le protocole de ce projet compare volontairement deux groupes.
    # La valeur k n'est donc plus modifiable depuis l'interface ou l'API.
    try:
        seed = int(data.get("seed", 42))
    except (TypeError, ValueError):
        raise BadRequest("Paramètre seed invalide.")
    k = 2
    return keys, k, seed


def parse_init(data):
    """Centres de départ placés sur la carte ACP : [[x1, y1], [x2, y2]] ou None (k-means++ automatique)."""
    raw = data.get("init_centers")
    if raw is None:
        return None
    try:
        arr = np.array(raw, dtype=float)
    except (TypeError, ValueError):
        raise BadRequest("Centroïdes de départ invalides.")
    if arr.shape != (2, 2) or not np.all(np.isfinite(arr)) or np.any(np.abs(arr) > 50):
        raise BadRequest("Il faut deux centroïdes de départ, chacun avec deux coordonnées.")
    return tuple(map(tuple, arr.round(3).tolist()))


def get_model(keys, k, seed, init=None):
    key = (tuple(keys), k, seed, init)
    if key not in _models:
        if len(_models) > 200:  # les placements manuels peuvent être nombreux : on borne le cache
            _models.clear()
        _models[key] = analysis.fit_model(X, Y, db.KEYS, keys, k, seed,
                                          init_pca=None if init is None else np.array(init))
    return _models[key]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/features")
def api_features():
    d = effect = analysis.effect_sizes(X, Y)
    return jsonify([
        {"key": key, "label": label, "description": desc,
         "min": float(X[:, i].min()), "max": float(X[:, i].max()),
         "mean": float(X[:, i].mean()), "std": float(X[:, i].std()),
         "mean_benin": float(X[Y == 0, i].mean()), "mean_malin": float(X[Y == 1, i].mean()),
         "effect_size": float(d[i])}
        for i, (key, label, desc) in enumerate(db.FEATURES)
    ])


@app.route("/api/summary")
def api_summary():
    return jsonify(total=int(len(Y)), n_malin=int(Y.sum()), n_benin=int((Y == 0).sum()))


@app.route("/api/tumeurs")
def api_tumeurs():
    limit = min(max(request.args.get("limit", 15, type=int), 1), 100)
    offset = max(request.args.get("offset", 0, type=int), 0)
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM tumeurs ORDER BY id LIMIT ? OFFSET ?", (limit, offset)).fetchall()
        total = conn.execute("SELECT COUNT(*) FROM tumeurs").fetchone()[0]
    return jsonify(total=total, rows=[dict(r) for r in rows])


@app.route("/api/cells")
def api_cells():
    """Données compactes pour dessiner chaque noyau (page de garde) : mesures + position sur la carte ACP."""
    m = get_model(db.KEYS, 2, 42)
    cols = ["radius", "concavity", "concave_points", "texture"]
    idx = [db.KEYS.index(c) for c in cols]
    rows = [[int(i), int(y), *[round(float(X[r, j]), 4) for j in idx],
             round(float(m.coords[r, 0]), 3), round(float(m.coords[r, 1]), 3)]
            for r, (i, y) in enumerate(zip(IDS, Y))]
    return jsonify(cols=["id", "malin", *cols, "pc1", "pc2"], rows=rows)


@app.route("/api/elbow")
def api_elbow():
    keys, _, seed = parse_params({"features": request.args.getlist("features") or None})
    return jsonify(analysis.elbow(X, db.KEYS, keys, kmax=8, seed=seed))


@app.route("/api/cluster", methods=["POST"])
def api_cluster():
    data = request.get_json(silent=True) or {}
    keys, k, seed = parse_params(data)
    init = parse_init(data)
    m = get_model(keys, k, seed, init)
    ref = get_model(keys, k, seed)  # référence : meilleur de 10 essais k-means++
    with db.connect() as conn:
        cur = conn.execute(
            "INSERT INTO analyses (k, features, inertia, silhouette, purity, ari, n_iter) VALUES (?,?,?,?,?,?,?)",
            (k, json.dumps(keys), m.metrics["inertia"], m.metrics["silhouette"],
             m.metrics["purity"], m.metrics["ari"], m.metrics["n_iter"]))
        analysis_id = cur.lastrowid
    return jsonify(
        id=analysis_id, k=k, features=keys, seed=seed, metrics=m.metrics,
        custom=init is not None, reference_inertia=ref.metrics["inertia"],
        pca={"ratio": m.ratio.round(4).tolist(),
             "loadings": [{key: float(v) for key, v in zip(keys, row)} for row in m.comps]},
        points=[[round(float(c[0]), 3), round(float(c[1]), 3), int(l), int(y), int(i)]
                for c, l, y, i in zip(m.coords, m.labels, Y, IDS)],
        centroids=m.project(m.km.centers_).round(3).tolist(),
        clusters=m.clusters)


@app.route("/api/steps", methods=["POST"])
def api_steps():
    """Instantanés réels du meilleur essai K-means, projetés sur les axes ACP."""
    data = request.get_json(silent=True) or {}
    keys, k, seed = parse_params(data)
    m = get_model(keys, k, seed, parse_init(data))
    frames = []
    for frame in m.km.trace_:
        centers_2d = m.project(frame["centers"]).round(3).tolist()
        labels = frame["labels"]
        frames.append({
            "phase": frame["phase"],
            "iteration": frame.get("iteration", 0),
            "centroids": centers_2d,
            "labels": labels.tolist() if labels is not None else None,
            "inertia": frame.get("inertia"),
            "shift": frame.get("shift"),
        })
    return jsonify(
        k=k, features=keys, points=m.coords.round(3).tolist(),
        frames=frames, n_iter=m.n_iter if hasattr(m, "n_iter") else m.metrics["n_iter"],
        pca_ratio=m.ratio.round(4).tolist()
    )


@app.route("/api/predict", methods=["POST"])
def api_predict():
    data = request.get_json(silent=True) or {}
    keys, k, seed = parse_params(data)
    values = data.get("values") or {}
    try:
        v = np.array([float(values[key]) for key in keys])
    except (KeyError, TypeError, ValueError):
        raise BadRequest("Renseignez une valeur numérique pour chaque variable choisie.")
    if not np.all(np.isfinite(v)) or np.any(v < 0):
        raise BadRequest("Les valeurs doivent être des nombres positifs.")
    m = get_model(keys, k, seed, parse_init(data))
    z = (v - m.mu) / m.sd
    cluster = int(m.km.predict(z)[0])
    dist = m.km.transform(z)[0]
    pct = m.clusters[cluster]["pct_malin"]
    with db.connect() as conn:
        conn.execute("INSERT INTO predictions (k, features, valeurs, cluster, pct_malin) VALUES (?,?,?,?,?)",
                     (k, json.dumps(keys), json.dumps(dict(zip(keys, v.tolist()))), cluster, pct))
    return jsonify(cluster=cluster, pct_malin=pct, size=m.clusters[cluster]["size"],
                   distances=[round(float(d), 3) for d in dist],
                   z={key: round(float(a), 2) for key, a in zip(keys, z)},
                   point=m.project(z)[0].round(3).tolist())


@app.route("/api/history", methods=["GET", "DELETE"])
def api_history():
    with db.connect() as conn:
        if request.method == "DELETE":
            conn.execute("DELETE FROM analyses")
            conn.execute("DELETE FROM predictions")
            return jsonify(ok=True)
        rows = conn.execute("SELECT * FROM analyses ORDER BY id DESC LIMIT 8").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["features"] = json.loads(d["features"])
        out.append(d)
    return jsonify(out)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
