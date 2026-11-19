"""K-means implémenté à la main avec NumPy (initialisation k-means++, plusieurs essais).

Algorithme de Lloyd :
    1. choisir k centres initiaux (k-means++ : centres éloignés les uns des autres) ;
    2. affecter chaque point au centre le plus proche (distance euclidienne) ;
    3. recalculer chaque centre comme la moyenne des points de son groupe ;
    4. répéter 2-3 jusqu'à ce que les centres ne bougent presque plus.
On garde le meilleur de `n_init` essais (inertie minimale).
"""
import numpy as np


class KMeans:
    def __init__(self, n_clusters=2, n_init=10, max_iter=300, tol=1e-6, random_state=None, init_centers=None):
        if n_clusters < 1:
            raise ValueError("n_clusters doit être >= 1")
        self.n_clusters = n_clusters
        self.n_init = n_init
        self.max_iter = max_iter
        self.tol = tol
        self.random_state = random_state
        # Centres de départ imposés (ex. placés à la main par l'utilisateur) : un seul essai, sans k-means++.
        self.init_centers = None if init_centers is None else np.asarray(init_centers, dtype=float)
        self.centers_ = None
        self.labels_ = None
        self.inertia_ = None
        self.n_iter_ = 0
        self.trace_ = []

    @staticmethod
    def _sq_distances(X, C):
        """Matrice (n, k) des distances euclidiennes au carré entre points et centres."""
        return ((X[:, None, :] - C[None, :, :]) ** 2).sum(axis=2)

    def _init_plus_plus(self, X, rng):
        n = X.shape[0]
        centers = np.empty((self.n_clusters, X.shape[1]))
        centers[0] = X[rng.integers(n)]
        d2 = ((X - centers[0]) ** 2).sum(axis=1)
        for i in range(1, self.n_clusters):
            total = d2.sum()
            idx = rng.integers(n) if total == 0 else rng.choice(n, p=d2 / total)
            centers[i] = X[idx]
            d2 = np.minimum(d2, ((X - centers[i]) ** 2).sum(axis=1))
        return centers

    def _run_once(self, X, rng):
        n = X.shape[0]
        if self.init_centers is not None:
            centers = self.init_centers.copy()
        else:
            centers = self._init_plus_plus(X, rng)
        # Historique visuel du même calcul : initialisation, affectation,
        # puis déplacement des centres à chaque itération.
        trace = [{"phase": "initialisation", "centers": centers.copy(), "labels": None}]
        tol_abs = self.tol * X.var(axis=0).mean()
        it = 0
        for it in range(1, self.max_iter + 1):
            d2 = self._sq_distances(X, centers)
            labels = d2.argmin(axis=1)
            trace.append({"phase": "affectation", "centers": centers.copy(),
                          "labels": labels.copy(), "iteration": it})
            new_centers = centers.copy()
            for j in range(self.n_clusters):
                members = labels == j
                if members.any():
                    new_centers[j] = X[members].mean(axis=0)
                else:  # groupe vide : on le relance sur le point le plus mal servi
                    new_centers[j] = X[d2[np.arange(n), labels].argmax()]
            shift = ((new_centers - centers) ** 2).sum()
            centers = new_centers
            trace.append({"phase": "recalcul", "centers": centers.copy(),
                          "labels": labels.copy(), "iteration": it,
                          "shift": float(shift)})
            if shift <= tol_abs:
                break
        d2 = self._sq_distances(X, centers)
        labels = d2.argmin(axis=1)
        inertia = d2[np.arange(n), labels].sum()
        trace.append({"phase": "convergence", "centers": centers.copy(),
                      "labels": labels.copy(), "iteration": it,
                      "inertia": float(inertia)})
        return centers, labels, float(inertia), it, trace

    def fit(self, X):
        X = np.asarray(X, dtype=float)
        if X.shape[0] < self.n_clusters:
            raise ValueError("Moins de points que de groupes")
        rng = np.random.default_rng(self.random_state)
        best = None
        n_init = self.n_init
        if self.init_centers is not None:
            if self.init_centers.shape != (self.n_clusters, X.shape[1]):
                raise ValueError("init_centers doit avoir la forme (n_clusters, n_variables)")
            n_init = 1
        for _ in range(n_init):
            run = self._run_once(X, rng)
            if best is None or run[2] < best[2]:
                best = run
        self.centers_, self.labels_, self.inertia_, self.n_iter_, self.trace_ = best
        return self

    def predict(self, X):
        X = np.atleast_2d(np.asarray(X, dtype=float))
        return self._sq_distances(X, self.centers_).argmin(axis=1)

    def transform(self, X):
        """Distances euclidiennes de chaque point à chaque centre."""
        X = np.atleast_2d(np.asarray(X, dtype=float))
        return np.sqrt(self._sq_distances(X, self.centers_))
