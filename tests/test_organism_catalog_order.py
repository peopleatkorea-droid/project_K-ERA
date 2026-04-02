from kera_research.domain import order_culture_species


def test_order_culture_species_uses_canonical_bacterial_hierarchy() -> None:
    unordered_species = [
        "Pseudomonas aeruginosa",
        "Granulicatella species",
        "Staphylococcus aureus",
        "Gemella species",
        "Other",
    ]

    assert order_culture_species("bacterial", unordered_species) == [
        "Staphylococcus aureus",
        "Gemella species",
        "Granulicatella species",
        "Pseudomonas aeruginosa",
        "Other",
    ]


def test_order_culture_species_uses_canonical_fungal_hierarchy() -> None:
    unordered_species = [
        "Candida",
        "Curvularia",
        "Other Molds",
        "Aspergillus",
        "Other",
        "Other Yeasts",
        "Fusarium",
        "Alternaria",
        "Australiasca species",
    ]

    assert order_culture_species("fungal", unordered_species) == [
        "Fusarium",
        "Aspergillus",
        "Alternaria",
        "Australiasca species",
        "Curvularia",
        "Other Molds",
        "Candida",
        "Other Yeasts",
        "Other",
    ]


def test_order_culture_species_appends_uncatalogued_species_after_known_items() -> None:
    unordered_species = [
        "Rare yeast",
        "Candida",
        "Fusarium",
        "Zygomycete sp.",
    ]

    assert order_culture_species("fungal", unordered_species) == [
        "Fusarium",
        "Candida",
        "Rare yeast",
        "Zygomycete sp.",
    ]
