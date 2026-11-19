"""Tests : python -m unittest discover -s tests"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from kmeans import KMeans  # noqa: E402
import analysis  # noqa: E402


class TestKMeans(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(0)
        self.X = np.vstack([rng.normal(0, .3, (50, 2)), rng.normal(5, .3, (50, 2))])

    def test_retrouve_deux_groupes(self):
        km = KMeans(2, random_state=1).fit(self.X)
        self.assertEqual(len(set(km.labels_[:50])), 1)
        self.assertEqual(len(set(km.labels_[50:])), 1)
        self.assertNotEqual(km.labels_[0], km.labels_[99])

    def test_reproductible(self):
        a = KMeans(3, random_state=7).fit(self.X)
        b = KMeans(3, random_state=7).fit(self.X)
        np.testing.assert_allclose(a.centers_, b.centers_)

    def test_predict_coherent(self):
        km = KMeans(2, random_state=1).fit(self.X)
        np.testing.assert_array_equal(km.predict(self.X), km.labels_)

    def test_inertie_decroit_avec_k(self):
        i = [KMeans(k, random_state=0).fit(self.X).inertia_ for k in (1, 2, 3)]
        self.assertGreater(i[0], i[1])
        self.assertGreaterEqual(i[1], i[2])


class TestCentresImposes(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(0)
        self.X = np.vstack([rng.normal(0, .3, (50, 2)), rng.normal(5, .3, (50, 2))])

    def test_centres_de_depart_respectes(self):
        init = np.array([[0.5, 0.5], [4.0, 4.0]])
        km = KMeans(2, init_centers=init).fit(self.X)
        np.testing.assert_allclose(km.trace_[0]["centers"], init)
        self.assertEqual(len(set(km.labels_[:50])), 1)

    def test_forme_invalide(self):
        with self.assertRaises(ValueError):
            KMeans(2, init_centers=np.zeros((3, 2))).fit(self.X)

    def test_unproject_revient_dans_le_plan(self):
        X = np.random.default_rng(1).normal(size=(60, 4))
        _, Z, _, _, comps, _ = analysis.projection(X, list("abcd"), list("abcd"))
        pts = np.array([[1.0, -2.0], [0.3, 0.7]])
        np.testing.assert_allclose(analysis.unproject(pts, comps) @ comps.T, pts, atol=1e-9)


class TestMetriques(unittest.TestCase):
    def test_ari_et_purete_parfaits(self):
        y = np.array([0, 0, 1, 1, 1])
        lab = np.array([1, 1, 0, 0, 0])
        self.assertAlmostEqual(analysis.adjusted_rand_index(lab, y), 1.0)
        self.assertAlmostEqual(analysis.purity(lab, y), 1.0)

    def test_silhouette_groupes_separes(self):
        Z = np.array([[0, 0], [0, 1], [10, 10], [10, 11]], dtype=float)
        self.assertGreater(analysis.silhouette(Z, np.array([0, 0, 1, 1])), 0.9)


if __name__ == "__main__":
    unittest.main()
