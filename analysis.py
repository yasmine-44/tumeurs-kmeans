"""Pré-traitement, ACP, métriques d'évaluation et ajustement d'un modèle K-means complet."""
from dataclasses import dataclass
import numpy as np
from kmeans import KMeans


def standardize(X):
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd[sd == 0] = 1.0
    return (X - mu) / sd, mu, sd


def pca(Z, n_components=2):
    """ACP par SVD. Retourne les axes (n_components, p) et la part de variance expliquée."""
    U, S, Vt = np.linalg.svd(Z - Z.mean(axis=0), full_matrices=False)
    var = S ** 2 / (len(Z) - 1)
    return Vt[:n_components], var[:n_components] / var.sum()


def silhouette(Z, labels):
    """Coefficient de silhouette moyen (entre -1 et 1) ; vectorisé, O(n²)."""
    ks = np.unique(labels)
    if len(ks) < 2:
        return 0.0
    D = np.sqrt(((Z[:, None, :] - Z[None, :, :]) ** 2).sum(axis=2))
    n = len(Z)
    mean_to = np.empty((n, len(ks)))
    for c, k in enumerate(ks):
        mean_to[:, c] = D[:, labels == k].sum(axis=1) / (labels == k).sum()
    s = np.zeros(n)
    for c, k in enumerate(ks):
        m = labels == k
        size = m.sum()
        if size == 1:
            continue
        a = D[m][:, m].sum(axis=1) / (size - 1)
        others = np.delete(mean_to[m], c, axis=1)
        b = others.min(axis=1)
        s[m] = (b - a) / np.maximum(a, b)
    return float(s.mean())


def purity(labels, y):
    return float(sum(np.bincount(y[labels == k]).max() for k in np.unique(labels)) / len(y))


def adjusted_rand_index(labels, y):
    def comb2(x):
        return x * (x - 1) / 2.0
    a_vals, a_inv = np.unique(labels, return_inverse=True)
    b_vals, b_inv = np.unique(y, return_inverse=True)
    table = np.zeros((len(a_vals), len(b_vals)))
    for i, j in zip(a_inv, b_inv):
        table[i, j] += 1
    sum_ij = comb2(table).sum()
    sum_a = comb2(table.sum(axis=1)).sum()
    sum_b = comb2(table.sum(axis=0)).sum()
    expected = sum_a * sum_b / comb2(len(y))
    max_index = (sum_a + sum_b) / 2
    if max_index == expected:
        return 1.0
    return float((sum_ij - expected) / (max_index - expected))


def effect_sizes(X, y):
    """d de Cohen entre tumeurs malignes (y=1) et bénignes (y=0), par variable."""
    m, b = X[y == 1], X[y == 0]
    pooled = np.sqrt(((len(m) - 1) * m.var(axis=0, ddof=1) + (len(b) - 1) * b.var(axis=0, ddof=1))
                     / (len(m) + len(b) - 2))
    return (m.mean(axis=0) - b.mean(axis=0)) / pooled


def elbow(X, all_keys, keys, kmax=8, seed=42):
    idx = [all_keys.index(c) for c in keys]
    Z, _, _ = standardize(X[:, idx])
    out = []
    for k in range(1, kmax + 1):
        km = KMeans(k, n_init=5, random_state=seed).fit(Z)
        out.append({"k": k, "inertia": km.inertia_,
                    "silhouette": silhouette(Z, km.labels_) if k > 1 else None})
    return out


@dataclass
class Model:
    keys: list
    k: int
    seed: int
    mu: np.ndarray
    sd: np.ndarray
    comps: np.ndarray
    ratio: np.ndarray
    km: KMeans
    labels: np.ndarray
    coords: np.ndarray
    clusters: list
    metrics: dict

    def project(self, z):
        return np.atleast_2d(z) @ self.comps.T


def projection(X, all_keys, keys, y=None):
    """Standardisation + ACP pour un jeu de variables : (Xs, Z, mu, sd, comps, ratio).

    Si y est fourni, l'axe 1 est orienté (simple confort d'affichage, sans effet sur K-means) pour que
    les tumeurs malignes soient à droite de la carte."""
    idx = [all_keys.index(c) for c in keys]
    Xs = X[:, idx]
    Z, mu, sd = standardize(Xs)
    comps, ratio = pca(Z)
    if y is not None and (Z @ comps[0])[y == 1].mean() < (Z @ comps[0])[y == 0].mean():
        comps[0] = -comps[0]
    return Xs, Z, mu, sd, comps, ratio


def unproject(points_2d, comps):
    """Ramène des points du plan de l'ACP dans l'espace standardisé (composantes hors plan = 0)."""
    return np.atleast_2d(np.asarray(points_2d, dtype=float)) @ comps


def fit_model(X, y, all_keys, keys, k, seed=42, init_pca=None):
    """y : 1 = malin, 0 = bénin. Les étiquettes ne servent PAS à l'apprentissage, seulement à l'évaluation.

    init_pca : centres de départ choisis par l'utilisateur sur la carte (coordonnées ACP, forme (k, 2)).
    Sans lui, on garde le meilleur de 10 essais k-means++."""
    Xs, Z, mu, sd, comps, ratio = projection(X, all_keys, keys, y)
    if init_pca is None:
        km = KMeans(k, n_init=10, random_state=seed).fit(Z)
    else:
        km = KMeans(k, random_state=seed, init_centers=unproject(init_pca, comps)).fit(Z)
    raw = km.labels_

    # Renumérotation : groupe 0 = le moins malin ... groupe k-1 = le plus malin (stable d'un appel à l'autre)
    pct = np.array([y[raw == j].mean() if (raw == j).any() else 0.0 for j in range(k)])
    sizes = np.array([(raw == j).sum() for j in range(k)])
    order = np.lexsort((sizes, pct))
    remap = np.empty(k, dtype=int)
    remap[order] = np.arange(k)
    km.centers_ = km.centers_[order]
    labels = remap[raw]
    # Appliquer le même ordre de groupes aux instantanés de la visualisation.
    for frame in km.trace_:
        frame["centers"] = frame["centers"][order]
        if frame["labels"] is not None:
            frame["labels"] = remap[frame["labels"]]

    coords = Z @ comps.T

    clusters = []
    for j in range(k):
        m = labels == j
        n_mal = int(y[m].sum())
        clusters.append({
            "id": j, "size": int(m.sum()), "n_malin": n_mal, "n_benin": int(m.sum()) - n_mal,
            "pct_malin": float(n_mal / m.sum()) if m.any() else 0.0,
            "means": {key: float(v) for key, v in zip(keys, Xs[m].mean(axis=0))},
            "z": {key: float(v) for key, v in zip(keys, km.centers_[j])},
        })
    metrics = {
        "inertia": float(km.inertia_), "n_iter": int(km.n_iter_),
        "silhouette": silhouette(Z, labels), "purity": purity(labels, y.astype(int)),
        "ari": adjusted_rand_index(labels, y.astype(int)),
    }
    return Model(list(keys), k, seed, mu, sd, comps, ratio, km, labels, coords, clusters, metrics)
