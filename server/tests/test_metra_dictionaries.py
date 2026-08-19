from metra import _export_dictionary_buckets


def test_export_buckets_merchants_only_cargos_not_shippers():
    buckets = _export_dictionary_buckets({
        'merchants': {1: 'ТКО организаций', 2: 'ТКО(КГО)'},
        'recipients': {},
        'suppliers': {},
        'operations': {},
        'drivers': {},
    })
    assert buckets['cargos'] == {'ТКО организаций', 'ТКО(КГО)'}
    assert buckets['shippers'] == set()
    assert buckets['receivers'] == set()


def test_export_buckets_suppliers_go_to_shippers():
    buckets = _export_dictionary_buckets({
        'merchants': {},
        'recipients': {},
        'suppliers': {1: 'ООО Полигон', 2: 'ИП Иванов'},
        'operations': {},
        'drivers': {},
    })
    assert buckets['shippers'] == {'ООО Полигон', 'ИП Иванов'}
    assert buckets['carriers'] == set()


def test_export_buckets_recipient_person_names_to_drivers():
    buckets = _export_dictionary_buckets({
        'merchants': {},
        'recipients': {1: 'Аленков А.А', 2: 'ООО Полигон'},
        'suppliers': {},
        'operations': {},
        'drivers': {},
    })
    assert buckets['drivers'] == {'Аленков А.А'}
    assert buckets['receivers'] == {'ООО Полигон'}


def test_export_buckets_operations_merge_into_cargos():
    buckets = _export_dictionary_buckets({
        'merchants': {1: 'ТКО'},
        'recipients': {},
        'suppliers': {},
        'operations': {1: 'Приём'},
        'drivers': {},
    })
    assert buckets['cargos'] == {'ТКО', 'Приём'}
