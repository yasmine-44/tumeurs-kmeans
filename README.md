# Profils tumoraux par K-means

Site web (Python / Flask) qui répond à la question : **« Les tumeurs bénignes et malignes : quelles
caractéristiques permettent de distinguer différents profils tumoraux ? »** en s'appuyant sur l'algorithme
**K-means**, implémenté à la main (NumPy), sans scikit-learn.

Données : *Breast Cancer Wisconsin (Diagnostic)* — 569 tumeurs du sein (357 bénignes, 212 malignes),
10 mesures calculées sur les noyaux cellulaires (rayon, texture, périmètre, aire, régularité, compacité,
concavité, points concaves, symétrie, dimension fractale). Source : UCI Machine Learning Repository.

## Lancer le projet

```bash
python -m venv venv
source venv/bin/activate        # Windows : venv\Scripts\activate
pip install -r requirements.txt
python app.py
```
Ouvrir http://127.0.0.1:5000. La base SQLite `data/tumeurs.db` est créée et remplie automatiquement
depuis `data/wdbc_mean.csv` si elle n'existe pas (`python database.py --reset` pour la recréer).
Tests : `python -m unittest discover -s tests`.

## Structure

| Fichier | Rôle |
|---|---|
| `kmeans.py` | K-means (Lloyd + k-means++ avec 10 essais, ou centres de départ imposés, groupes vides gérés) |
| `analysis.py` | standardisation, ACP (SVD), silhouette, pureté, indice de Rand ajusté, d de Cohen, méthode du coude, ajustement d'un modèle |
| `database.py` + `schema.sql` | base SQLite : tables `tumeurs`, `analyses`, `predictions` |
| `app.py` | API Flask et page d'accueil |
| `templates/index.html`, `static/style.css`, `static/app.js` | frontend (HTML/CSS/JS sans dépendance externe, graphiques dessinés en canvas) |
| `tests/test_projet.py` | tests unitaires |

## Interface

- **Page de garde** : un champ de microscope dessiné avec les 569 vraies tumeurs. Chaque noyau est dessiné d'après ses mesures
  (taille = rayon, contour tourmenté = points concaves, grains = texture) et placé selon sa position sur la carte ACP.
  **Rouge = malin, bleu = bénin** partout dans le site.
- **Atelier K-means** : les deux centroïdes de départ sont **modifiables** : on les glisse sur la carte ACP ou on saisit leurs
  coordonnées. Quatre départs prédéfinis (K-means++, un par nuage, tous deux côté bénin, au hasard). Le bouton « Lancer » appelle
  le backend, qui exécute K-means depuis ces centres (un seul essai) et renvoie chaque étape (affectation, recalcul, convergence).
  Le site indique ensuite si le départ choisi mène à la même solution que K-means++ ou à un autre minimum local.
- Les centroïdes sont placés dans le plan de l'ACP ; le serveur les ramène dans l'espace standardisé (composantes hors plan = 0).

## API

| Route | Description |
|---|---|
| `GET /api/features` | variables, statistiques et écart bénin/malin (d de Cohen) |
| `GET /api/summary` | effectifs |
| `GET /api/tumeurs?limit=&offset=` | lecture paginée de la base |
| `GET /api/elbow?features=...` | inertie et silhouette pour k = 1..8 |
| `GET /api/cells` | mesures + position ACP de chaque tumeur (page de garde) |
| `POST /api/cluster` `{features, init_centers?}` | lance K-means, renvoie points ACP, centres, profils, métriques (enregistré dans `analyses`) |
| `POST /api/steps` `{features, init_centers?}` | renvoie les instantanés du meilleur essai K-means pour la visualisation interactive |
| `POST /api/predict` `{features, values, init_centers?}` | rattache une nouvelle tumeur au groupe le plus proche (enregistré dans `predictions`) |
| `GET / DELETE /api/history` | historique des analyses |

## Démarche et lecture des résultats

1. Les variables sont **standardisées** (sinon l'aire, en centaines, écraserait la régularité, en centièmes).
2. K-means est **non supervisé** : le diagnostic n'est jamais utilisé pour former les groupes.
3. Il sert ensuite à **évaluer** : pureté, indice de Rand ajusté, part de tumeurs malignes par groupe.
4. Les groupes sont renumérotés du moins au plus malin (groupe 1 = bleu, groupe 2 = rouge).
5. `init_centers` = `[[x1, y1], [x2, y2]]` en coordonnées ACP ; sans lui, meilleur de 10 essais k-means++.

Résultats avec les 10 variables et k = 2 : silhouette ≈ 0,39, pureté ≈ 90 %, indice de Rand ajusté ≈ 0,65.
Un groupe est à 12 % de tumeurs malignes, l'autre à 96 %. Les variables qui séparent le mieux bénin et malin
sont les points concaves, le périmètre, le rayon, l'aire et la concavité (d de Cohen > 2).

## Limites à mentionner

- K-means suppose des groupes plutôt sphériques et dépend de l'échelle et du choix de k.
- La pureté n'est pas une précision de diagnostic : un groupe n'est pas un diagnostic.
- Jeu de données petit et ancien (années 1990), mesures de laboratoire : outil pédagogique uniquement.
