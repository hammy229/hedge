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


def test_standards_are_not_issue_keys():
    text = "Encode as UTF-8, hash with SHA-256, see RFC-7231 and ISO-8859"
    assert strip_answer_text(text) == text
    assert strip_answer_text(text, project_keys={"HADOOP"}) == text
    assert strip_answer_text("UTF-8 breaks in HDFS-12") == "UTF-8 breaks in"


def test_lowercase_keys_need_known_projects():
    assert strip_answer_text("dup of hadoop-1234") == "hadoop-1234"
    assert strip_answer_text("dup of hadoop-1234", project_keys={"HADOOP"}) == ""
    assert strip_answer_text("Hadoop-9 and HADOOP-10", project_keys=["HADOOP"]) == "and"
    # lowercase words that only look like keys stay, even with project keys given
    assert strip_answer_text("needs python-3 and java-8", project_keys={"HADOOP"}) == "needs python-3 and java-8"


def test_copy_detection_uses_project_keys():
    train = ["Crash on save hadoop-12"]
    test = ["crash on save HADOOP-99", "crash on save hadoop-99"]
    assert cross_split_duplicates(train, test) == []  # without keys, "hadoop-12" stays as text
    assert cross_split_duplicates(train, test, project_keys={"HADOOP"}) == [0, 1]


def test_key_stripping_matches_the_alternation_it_replaced():
    # The old implementation: uppercase keys, or known project names in any case.
    import random
    import re

    from hedge.leakage import ISSUE_KEY, _strip_keys

    keys = {"HADOOP", "MC", "SPARK_X", "AB1"}
    names = "|".join(re.escape(k) for k in sorted(keys, key=len, reverse=True))
    old = re.compile(rf"{ISSUE_KEY.pattern}|\b(?i:{names})-\d+\b")
    rng = random.Random(0)
    parts = ["HADOOP", "hadoop", "Mc", "mc", "MCX", "spark_x", "UTF", "utf", "SHA", "python", "AB1", "x", "_", "-", "12", "3", " ", ".", "/"]
    for _ in range(5000):
        text = "".join(rng.choice(parts) for _ in range(rng.randint(1, 8)))
        assert _strip_keys(text, keys) == old.sub(" ", text), text
