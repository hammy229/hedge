import pytest

from hedge.leakage import cross_split_duplicates, normalize, strip_answer_text


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Duplicate of HADOOP-1234", ""),
        ("Closing as dupe, see HDFS-9", ", see"),
        ("This is a duplicate of SPARK-12 and crashes", "This and crashes"),
        ("See https://issues.apache.org/jira/browse/KAFKA-77 for logs", "See for logs"),
        ("NPE in parser", "NPE in parser"),
    ],
)
def test_strip_answer_text(raw, expected):
    assert strip_answer_text(raw) == expected


def test_strip_keeps_ordinary_words():
    # "duplicated" in normal prose is not an answer leak.
    assert "duplicated rows" in strip_answer_text("The export has duplicated rows")


def test_normalize_ignores_case_punctuation_and_keys():
    assert normalize("NPE in Parser!! (YARN-3)") == normalize("npe in parser")


def test_cross_split_duplicates():
    train = ["NullPointerException in Parser.parse()", "Slow startup"]
    test = ["nullpointerexception in parser parse", "Totally new bug", "", "SLOW startup."]
    assert cross_split_duplicates(train, test) == [0, 3]


def test_empty_texts_never_match():
    assert cross_split_duplicates([""], [""]) == []
