from text_encoding import (
    decode_db_text,
    format_person_name,
    format_vehicle_brand,
    format_vehicle_plate,
    is_readable_name,
    is_readable_vehicle_number,
    looks_like_mojibake,
    normalize_vehicle_key,
    split_person_names,
)


class TestVehiclePlateNormalization:
    def test_latin_lookalikes_become_cyrillic(self):
        assert format_vehicle_plate('A123BC') == 'А123ВС56'
        assert normalize_vehicle_key('A123BC') == 'а123вс56'

    def test_spaces_and_dashes_are_stripped(self):
        assert format_vehicle_plate('А 123 ВС 56') == 'А123ВС56'
        assert format_vehicle_plate('А-123-ВС-56') == 'А123ВС56'
        assert normalize_vehicle_key('А 123 ВС 56') == normalize_vehicle_key('А123ВС56')

    def test_missing_region_defaults_to_56(self):
        assert format_vehicle_plate('А123ВС') == 'А123ВС56'
        assert normalize_vehicle_key('А123ВС') == 'а123вс56'

    def test_three_digit_region_preserved(self):
        assert format_vehicle_plate('А123ВС777') == 'А123ВС777'
        assert normalize_vehicle_key('А123ВС777') == 'а123вс777'

    def test_same_plate_different_formatting_share_key(self):
        assert normalize_vehicle_key('а123вс56') == normalize_vehicle_key('A 123 BC 56')

    def test_empty_input(self):
        assert format_vehicle_plate('   ') == ''
        assert normalize_vehicle_key('') == ''

    def test_digits_letters_body(self):
        assert format_vehicle_plate('1234АА56') == '1234АА56'


class TestPersonAndBrandFormatting:
    def test_person_name_title_case(self):
        assert format_person_name('иванов и.и.') == 'Иванов И.И.'

    def test_person_name_collapses_whitespace(self):
        assert format_person_name('  петров   п.п.  ') == 'Петров П.П.'

    def test_brand_preserves_leading_digits(self):
        assert format_vehicle_brand('камаз 65115') == 'Камаз 65115'

    def test_empty_values(self):
        assert format_person_name(' ') == ''
        assert format_vehicle_brand('') == ''


class TestTextDecodingAndValidation:
    def test_decode_cp1251_bytes(self):
        assert decode_db_text('Камаз'.encode('cp1251')) == 'Камаз'

    def test_readable_name_rejects_short_and_unfixable_mojibake(self):
        assert is_readable_name('А') is False
        assert is_readable_name('Камаз') is True
        # UTF-8 misread as Latin-1 can be repaired by decode_db_text.
        assert is_readable_name('ÐšÐ°Ð¼Ð°Ð·') is True
        # Unrecoverable mojibake stays unreadable.
        assert is_readable_name('P¡P°P¼PsP²P°P»') is False

    def test_looks_like_mojibake_detects_markers(self):
        assert looks_like_mojibake('ÐšÐ°Ð¼Ð°Ð·') is True
        assert looks_like_mojibake('P¡P°P¼PsP²P°P»') is True
        assert looks_like_mojibake('Самосвал') is False

    def test_readable_vehicle_number(self):
        assert is_readable_vehicle_number('А123ВС56') is True
        assert is_readable_vehicle_number('??') is False

    def test_split_person_names_from_delimited_list(self):
        names = split_person_names('Иванов И.И.; Петров П.П., Сидоров С.С.')
        assert names == ['Иванов И.И.', 'Петров П.П.', 'Сидоров С.С.']

    def test_split_person_names_dedupes(self):
        names = split_person_names('Иванов И.И., Иванов И.И.')
        assert names == ['Иванов И.И.']
