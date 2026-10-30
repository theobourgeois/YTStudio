"""Fill inserts' pure logic: python test/fill_inserts_test.py"""
import os
import struct
import sys
import tempfile
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import fillinserts as fi  # noqa: E402
import flpread  # noqa: E402


def track(index, name=None, routes=None, fx=0, color=0):
    return {"index": index, "name": name or ("Insert %d" % index), "color": color, "fx": fx,
            "routes": [{"to": t, "level": 1.0} for t in ([0] if routes is None else routes)]}


def blank(count=40):
    return [{"index": 0, "name": "Master", "color": 0, "fx": 0, "routes": []}] + [track(i) for i in range(1, count)]


def template(count=40):
    """The user's own layout: buses at 22 to 26, Record on 16, vocals 17 to 21."""
    t = blank(count)
    t[16] = track(16, "Record", routes=[])
    for i in range(17, 22):
        t[i] = track(i, "Vocal", routes=[25])
    t[22], t[23], t[24] = track(22, "Instr", routes=[26]), track(23, "Bass", routes=[26]), track(24, "Drums", routes=[26])
    t[25], t[26] = track(25, "Vocal Bus", routes=[26]), track(26, "Mix Bus", routes=[0])
    return t


def chan(index, name, target=0, type=fi.GENERATOR, plugin="Serum 2"):
    return {"index": index, "name": name, "target": target, "type": type, "plugin": plugin if type == fi.GENERATOR else None}


def sound(c, role, name=None):
    return {"channel": c["index"], "channelName": c["name"], "plugin": c.get("plugin"), "target": c["target"],
            "type": c["type"], "name": name or c["name"], "role": role, "why": "", "evidence": {}}


# The app's rules

def test_app_rules_match_the_app():
    cases = [
        (("808 - Neonhearted [Ginseng].wav", None, None), "bass"),
        ((None, "BD 808 Long", None), "bass"),
        ((None, "anything", "808"), "bass"),
        (("[SAINT6] 808 Hi Hat 1.wav", None, None), "bass"),  # all 808s, the user's convention
        (("FX - 199X [Ginseng].wav", None, None), "drums"),
        (("FX_199X [Ginseng].wav", None, None), "drums"),
        (("FX - blackout paradise [Ginseng].wav", None, None), None),
        ((None, "x", "Bass"), "bass"),
        ((None, "BA Angry Boss [JL]", None), "bass"),
        ((None, "BS Thing", None), "bass"),
        ((None, "SY Drawbar Organ [ASL]", None), "instr"),
        ((None, "LD PeterPiper [SD]", None), "instr"),
        ((None, "PL Sunny [7S]", None), "instr"),
        ((None, "VOX Choir", None), "instr"),
        ((None, "x", "Vocal"), "instr"),
        (("x.wav", None, "Vocal"), None),  # a vocal sample isn't an instrument
        ((None, "x", "Drum"), "drums"),
        (("KICK - x.wav", None, None), "drums"),
        (("SNARE_x.wav", None, None), "drums"),
        (("OH - Subtitles [Ginseng].wav", None, None), "drums"),
        (("Kick.wav", None, "Lead"), "instr"),  # the category comes first
        ((None, "Generic Thing", None), None),
    ]
    for args, want in cases:
        assert fi.explicit_role(*args) == want, (args, want)


def test_name_words():
    assert fi.name_role(None, "MO_ELX_BA_House") == "bass"
    assert fi.name_role(None, "MO_SHINJU_LD_Raskolnikov") == "instr"
    assert fi.name_role(None, "[PS] bass [hyper]") == "bass"
    assert fi.name_role(None, "lead [fallacy]") == "instr"
    assert fi.name_role("pbs - amped up [ Kick ].wav") == "drums"
    assert fi.name_role("[SAINT6] Ronny Kick.wav") == "drums"
    assert fi.name_role("FX - cinema violence [Ginseng].wav") == "drums"
    assert fi.name_role("Riser SFX.wav") == "drums"
    assert fi.explicit_role(None, "Whatever", "SFX") == "drums"  # Serum's category
    assert fi.name_role(None, "FX Bass Riser") is None  # points two ways
    assert fi.name_role(None, "bass lead") is None  # points two ways
    assert fi.name_role(None, "Subtle Thing") is None  # a word, not part of one
    assert fi.name_role("NDTWK-SNARE4.wav") == "drums"  # numbered
    assert fi.name_role("NDTWK-OHAT1-BENZ.wav") == "drums"
    assert fi.name_role(None, "Chords - Slow Burn") == "instr"


def test_fancy_letters_are_letters():
    fancy = "\U0001d5e8\U0001d5fb\U0001d5f3\U0001d5fc\U0001d5f9\U0001d5f1 \U0001d5e3\U0001d5f9\U0001d602\U0001d5f0\U0001d5f8 (MIDI) (Nastiest_Below)"
    assert fi.name_role(None, fancy) == "instr"
    assert fi.display_name({"name": "Serum 2"}, {"preset": fancy}) == "Unfold Pluck (MIDI) (Nastiest_Below)"
    assert fi.explicit_role(None, "\U0001d5d5\U0001d5d4 thing") == "bass"


def test_the_list_follows_a_save():
    """An unsaved project's Serums have no names, then it's saved: the list reads again by itself, once, and a save that
    says nothing new doesn't."""
    import fill_worker as fw
    import worker_base as wb

    class Link:
        pid, title = -1, "FL Studio 2025"
        hello = {"version": 7}

        def __init__(self):
            self.calls = 0

        def call(self, cmd, **kw):
            self.calls += 1
            return {"tracks": [{"index": 0, "name": "Master", "routes": []}],
                    "channels": [{"index": 0, "name": "Serum 2", "type": fi.GENERATOR, "target": 0, "plugin": "Serum 2"}]}

    files = {"written": 0, "saved": []}
    was = fw.flpread.newest, fw.flpread.find, wb.sink, fi.jev_key, fi.serum_db_path
    fw.flpread.newest = lambda project: files["written"]
    fw.flpread.find = lambda project, names: (os.path.abspath(__file__), files["saved"]) if files["saved"] else (None, [])
    wb.sink = lambda ev, fields: None
    fi.jev_key = lambda: None
    fi.serum_db_path = lambda: None
    try:
        w = fw.FillWorker(0)
        w.link = Link()
        w.fill_scan()
        assert w.fill["sounds"][0]["detected"] is None and w.link.calls == 1
        w.idle()
        assert w.link.calls == 1  # nothing's happened
        w.link.title = "song.flp - FL Studio 2025"  # saved for the first time
        files["written"] = 5
        files["saved"] = [{"name": "Serum 2", "preset": "LD thing", "sample": None}]
        w.idle()
        assert w.link.calls == 2 and w.fill["sounds"][0]["detected"] == "instr" and w.fill["project"] == "song"
        w.idle()
        assert w.link.calls == 2
        files["written"] = 6  # saved again, the same sounds
        w.idle()
        assert w.link.calls == 2
        files["written"] = 7  # another preset
        files["saved"] = [{"name": "Serum 2", "preset": "BA thing", "sample": None}]
        w.idle()
        assert w.link.calls == 3 and w.fill["sounds"][0]["detected"] == "bass"
    finally:
        fw.flpread.newest, fw.flpread.find, wb.sink, fi.jev_key, fi.serum_db_path = was


def test_an_insert_with_its_fader_moved_isnt_free():
    tracks = template()
    tracks[3]["value"] = 0.05
    assert 3 not in fi.free_inserts(tracks, [])
    assert 4 in fi.free_inserts(tracks, [])


def test_a_colour_from_fl_with_its_top_byte_is_the_same_colour():
    tracks = template()
    tracks[1]["color"] = fi.COLOURS["instr"] | 0xff000000
    tracks[1]["name"] = "Pad"
    tracks[22], tracks[26] = track(22, "Instr", routes=[26]), track(26, "Mix Bus", routes=[0])
    tracks[1]["routes"] = [{"to": 22, "level": 0.8}]
    sound = {"name": "Pad", "channel": 0, "channelName": "Pad", "plugin": None, "target": 1, "role": "instr"}
    plan = fi.build_plan(tracks, [chan(0, "Pad", 1)], [sound])
    assert plan["changes"] == 0, plan


def test_order_of_evidence():
    tracks = template()
    chans = [chan(0, "Serum 2", 1), chan(1, "Serum 2 #2", 2), chan(2, "FX - a.wav", 3, fi.SAMPLER), chan(3, "Serum 2 #3", 4)]
    tracks[3] = track(3, "FX - a", routes=[24])  # already routed to Drums, and nothing else says what it is
    saved = [{"preset": "Whatever One"}, {"preset": "MO_X_BA_Y"}, {"sample": "FX - a.wav"}, None]
    sounds = fi.make_sounds(chans, tracks, saved)
    seen = []

    def jev(evidence):
        seen.extend(evidence)
        return {evidence[0]["channelId"]: "instr"}

    sounds, problem = fi.classify(sounds, categories=lambda n: "Lead" if n == "Whatever One" else None, jev=jev)
    assert problem is None
    assert (sounds[0]["role"], sounds[0]["why"]) == ("instr", "Serum: Lead")
    assert (sounds[1]["role"], sounds[1]["why"]) == ("bass", "Name")
    assert (sounds[2]["role"], sounds[2]["why"]) == ("drums", "Already there")
    assert sounds[3]["role"] is None and sounds[3]["why"] == "Needs a group"  # "Serum 2 #3": nothing to go on, not asked
    assert seen == []


def test_jev_is_asked_only_what_rules_cant_answer_and_low_confidence_stays_unknown():
    bodies = []

    def post(body, key):
        bodies.append(body)
        assert key == "k"
        return {"answers": {"channel_0": {"choice": "bass", "confidence": 0.9},
                            "channel_1": {"choice": "instr", "confidence": 0.5},
                            "channel_2": {"choice": "unknown", "confidence": 0.99}}}

    sounds = [{"channel": i, "evidence": {"preset": n, "filename": None}, "onBus": None}
              for i, n in enumerate(["Mystery A", "Mystery B", "Mystery C", "lead one"])]
    sounds, problem = fi.classify(sounds, jev=lambda e: fi.ask_jev(e, "k", post))
    assert problem is None
    assert [s["role"] for s in sounds] == ["bass", None, None, "instr"]
    assert [s["why"] for s in sounds] == ["Jev", "Needs a group", "Needs a group", "Name"]
    assert len(bodies) == 1 and len(bodies[0]["state"]["channels"]) == 3
    assert bodies[0]["model"] == fi.JEV_MODEL
    assert set(bodies[0]["questions"]["channel_0"]["criteria"]) == {"instr", "bass", "drums", "unknown"}


def test_jev_failure_says_so_and_guesses_nothing():
    def jev(_):
        raise RuntimeError("Jev answered 401")
    sounds = [{"channel": 0, "evidence": {"preset": "Mystery", "filename": None}, "onBus": None}]
    sounds, problem = fi.classify(sounds, jev=jev)
    assert sounds[0]["role"] is None and problem == "Jev answered 401"


def test_jev_batches():
    calls = []

    def post(body, key):
        calls.append(len(body["state"]["channels"]))
        return {"answers": {}}
    fi.ask_jev([{"channelId": str(i)} for i in range(70)], "k", post)
    assert calls == [32, 32, 6]


def test_key_never_in_the_error():
    import urllib.error

    def post(body, key):
        raise urllib.error.URLError("no route for secret-key")
    try:
        fi.ask_jev([{"channelId": "0"}], "secret-key", post)
    except RuntimeError as e:
        assert "secret" not in str(e)
    else:
        raise AssertionError("should have raised")


# The plan

def apply_to(plan, tracks, channels):
    """Runs a plan the way the script does, on plain data, so a test can look at the result."""
    by = {t["index"]: t for t in tracks}
    for m in plan["channels"]:
        next(c for c in channels if c["index"] == m["index"])["target"] = m["target"]
    for i in plan["inserts"]:
        t = by[i["index"]]
        if "name" in i:
            t["name"] = i["name"]
        if "color" in i:
            t["color"] = i["color"]
        for to in i.get("on", []):
            t["routes"].append({"to": to, "level": 1.0})
        t["routes"] = [r for r in t["routes"] if r["to"] not in i.get("off", [])]


def test_new_project_gets_buses_and_the_apps_order():
    tracks, chans = blank(), [chan(0, "Serum 2"), chan(1, "Kick", type=fi.SAMPLER), chan(2, "Serum 2 #2")]
    sounds = [sound(chans[0], "instr", "Lead One"), sound(chans[1], "drums"), sound(chans[2], "bass", "Sub One")]
    plan = fi.build_plan(tracks, chans, sounds)
    assert [(s["channelName"], s["to"]) for s in plan["sounds"]] == [("Serum 2", 1), ("Kick", 3), ("Serum 2 #2", 2)]
    apply_to(plan, tracks, chans)
    assert [tracks[i]["name"] for i in (1, 2, 3)] == ["Lead One", "Sub One", "Kick"]
    assert [tracks[i]["name"] for i in (22, 23, 24, 26)] == ["Instr", "Bass", "Drums", "Mix Bus"]
    assert {r["to"] for r in tracks[1]["routes"]} == {22}
    assert {r["to"] for r in tracks[2]["routes"]} == {23}
    assert {r["to"] for r in tracks[3]["routes"]} == {24}
    assert {r["to"] for r in tracks[22]["routes"]} == {26}
    assert {r["to"] for r in tracks[26]["routes"]} == {0}
    assert tracks[1]["color"] == fi.COLOURS["instr"] and tracks[22]["color"] == fi.COLOURS["instr"]
    assert tracks[25]["name"] == "Insert 25"  # no vocal bus was asked for


def test_filled_project_keeps_its_slots_and_its_buses():
    tracks = template()
    for i in range(1, 4):
        tracks[i] = track(i, "Serum 2 #%d" % i if i > 1 else "Serum 2", routes=[0])
    chans = [chan(0, "Serum 2", 1), chan(1, "Serum 2 #2", 2), chan(2, "Serum 2 #3", 3)]
    plan = fi.build_plan(tracks, chans, [sound(chans[0], "instr", "A"), sound(chans[1], "bass", "B"), sound(chans[2], "instr", "C")])
    assert plan["channels"] == [] and plan["newBuses"] == []
    assert [s["to"] for s in plan["sounds"]] == [1, 2, 3]
    apply_to(plan, tracks, chans)
    assert {r["to"] for r in tracks[1]["routes"]} == {22}
    assert {r["to"] for r in tracks[2]["routes"]} == {23}
    assert tracks[1]["name"] == "A"
    assert tracks[22]["color"] == 0  # the user's buses keep their colours


def test_running_it_twice_changes_nothing():
    tracks, chans = blank(), [chan(0, "Serum 2"), chan(1, "Kick", type=fi.SAMPLER)]
    plan = fi.build_plan(tracks, chans, [sound(chans[0], "instr", "A"), sound(chans[1], "drums")])
    apply_to(plan, tracks, chans)
    again = fi.build_plan(tracks, chans, [sound(chans[0], "instr", "A"), sound(chans[1], "drums")])
    assert again["changes"] == 0, again


def test_a_preset_named_like_the_vocals_keeps_its_insert_after_filling():
    """Found on a real project: "VOX - No Happiness" named its insert, and the second look took that for the vocals'."""
    tracks, chans = template(), [chan(0, "Serum 2", 4), chan(1, "Kick", 5, fi.SAMPLER)]
    tracks[4], tracks[5] = track(4, "Serum 2"), track(5, "Kick")
    sounds = lambda: [sound(chans[0], "instr", "VOX - No Happiness"), sound(chans[1], "drums")]
    plan = fi.build_plan(tracks, chans, sounds())
    assert [s["to"] for s in plan["sounds"]] == [4, 5]
    apply_to(plan, tracks, chans)
    assert tracks[4]["name"] == "VOX - No Happiness"
    again = fi.build_plan(tracks, chans, sounds())
    assert again["changes"] == 0 and [s["to"] for s in again["sounds"]] == [4, 5], again
    assert fi.free_inserts(tracks, chans, sounds())[0] == 1  # and it isn't where the reserved inserts start


def test_an_insert_named_for_the_vocals_is_still_left_alone():
    tracks, chans = template(), [chan(0, "Serum 2", 4)]
    tracks[4] = track(4, "Vox")
    plan = fi.build_plan(tracks, chans, [sound(chans[0], "instr", "Some Lead")])
    assert plan["sounds"][0]["to"] != 4 and "recording" in plan["sounds"][0]["note"]


def test_a_sound_takes_its_buss_colour_and_a_default_bus_doesnt_count():
    default, mine = 0xff4f626f, 0xff9f3835
    tracks = template()
    for t in tracks[1:]:
        t["color"] = default
    tracks[22]["color"] = mine
    chans = [chan(0, "Serum 2", 1), chan(1, "Serum 2 #2", 2)]
    tracks[1], tracks[2] = track(1, "Serum 2", color=default), track(2, "Serum 2 #2", color=default)
    plan = fi.build_plan(tracks, chans, [sound(chans[0], "instr", "A"), sound(chans[1], "bass", "B")])
    ops = {i["index"]: i for i in plan["inserts"]}
    assert ops[1]["color"] == mine & 0xffffff  # Instr has the user's colour
    assert ops[2]["color"] == fi.COLOURS["bass"]  # Bass is still FL's default
    apply_to(plan, tracks, chans)
    assert fi.build_plan(tracks, chans, [sound(chans[0], "instr", "A"), sound(chans[1], "bass", "B")])["changes"] == 0


def test_with_no_free_insert_it_says_what_to_do():
    tracks = template(27)
    for i in range(1, 16):
        tracks[i] = track(i, "Sound %d" % i, routes=[22])
    chans = [chan(0, "Serum 2", 22)]
    plan = fi.build_plan(tracks, chans, [sound(chans[0], "instr", "A")])
    assert plan["changes"] == 0 and "add inserts" in plan["sounds"][0]["note"]


def test_colours_are_the_apps_as_fl_takes_them():
    """FL's script reads and writes 0xRRGGBB (checked by eye in FL), the same digits as the app's #rrggbb."""
    assert fi.COLOURS == {"instr": 0xc85454, "bass": 0x5279cf, "drums": 0xc6aa43, "vocal": 0x4e9d61, "mix": 0x409ca0}


def test_recordings_are_left_alone_and_a_sound_on_record_is_moved_with_a_note():
    tracks = template()
    for i in range(1, 16):
        tracks[i] = track(i, "Sound %d" % i, routes=[24])
    chans = [chan(0, "OH - Subtitles", 16, fi.SAMPLER), chan(1, "take 1", 16, fi.AUDIO_CLIP), chan(2, "take 2", 17, fi.AUDIO_CLIP)]
    plan = fi.build_plan(tracks, chans, [sound(chans[0], "drums")])
    s = plan["sounds"][0]
    assert s["to"] == 27 and "Record" in s["note"]  # the 15 before Record are full, so after the Mix Bus
    assert plan["channels"] == [{"index": 0, "target": 27}]
    assert all(i["index"] not in (16, 17, 18, 19, 20, 21) for i in plan["inserts"])


def test_shared_insert_first_keeps_it_others_move():
    tracks = template()
    tracks[1] = track(1, "Serum 2", fx=2)
    chans = [chan(0, "Serum 2", 1), chan(1, "Serum 2 #2", 1)]
    plan = fi.build_plan(tracks, chans, [sound(chans[0], "instr"), sound(chans[1], "bass")])
    assert plan["sounds"][0]["to"] == 1
    assert plan["sounds"][1]["to"] != 1
    assert "sharing" in plan["sounds"][1]["note"] and "effects" in plan["sounds"][1]["note"]


def test_sound_sharing_with_a_skipped_one_moves_and_skipped_stays():
    tracks = template()
    chans = [chan(0, "Serum 2", 1), chan(1, "Serum 2 #2", 1)]
    plan = fi.build_plan(tracks, chans, [sound(chans[0], fi.SKIP), sound(chans[1], "bass")])
    assert plan["sounds"][0]["to"] is None
    assert plan["sounds"][1]["to"] not in (None, 1)
    assert not any(m["index"] == 0 for m in plan["channels"])


def test_sound_directly_on_a_bus_gets_its_own():
    tracks = template()
    chans = [chan(0, "Kick", 24, fi.SAMPLER)]
    plan = fi.build_plan(tracks, chans, [sound(chans[0], "drums")])
    assert plan["sounds"][0]["to"] == 1 and "bus" in plan["sounds"][0]["note"]


def test_a_send_somewhere_else_means_the_routing_is_the_users():
    tracks = template()
    tracks[1] = track(1, "Serum 2", routes=[0, 30])
    tracks[30] = track(30, "Reverb", routes=[0])
    chans = [chan(0, "Serum 2", 1)]
    plan = fi.build_plan(tracks, chans, [sound(chans[0], "instr", "A")])
    assert "Reverb" in plan["sounds"][0]["note"]
    op = next(i for i in plan["inserts"] if i["index"] == 1)
    assert "on" not in op and "off" not in op and op["name"] == "A"


def test_sidechain_sends_stay():
    tracks = template()
    tracks[1] = track(1, "Serum 2", routes=[0])
    tracks[1]["routes"].append({"to": 5, "level": 0.0})
    chans = [chan(0, "Serum 2", 1)]
    plan = fi.build_plan(tracks, chans, [sound(chans[0], "instr", "A")])
    op = next(i for i in plan["inserts"] if i["index"] == 1)
    assert op["on"] == [22] and op["off"] == [0] and plan["sounds"][0]["note"] == ""


def test_a_name_the_user_gave_stays():
    tracks = template()
    tracks[1] = track(1, "My Main Lead")
    chans = [chan(0, "Serum 2", 1)]
    plan = fi.build_plan(tracks, chans, [sound(chans[0], "instr", "A")])
    assert "name" not in next(i for i in plan["inserts"] if i["index"] == 1)


def test_used_inserts_arent_free():
    tracks = blank()
    tracks[1] = track(1, fx=1)  # effects on it
    tracks[2] = track(2, routes=[3])  # routed somewhere
    tracks[3] = track(3)  # fed by 2
    tracks[4] = track(4)  # a take is on it
    chans = [chan(0, "take", 4, fi.AUDIO_CLIP)]
    assert fi.free_inserts(tracks, chans)[0] == 5


def test_out_of_inserts():
    tracks = template(28)
    for i in list(range(1, 16)) + [27]:
        tracks[i] = track(i, "Sound %d" % i, routes=[24])
    chans = [chan(0, "Kick", 0, fi.SAMPLER)]
    plan = fi.build_plan(tracks, chans, [sound(chans[0], "drums")])
    assert plan["sounds"][0]["to"] is None and "No free insert" in plan["sounds"][0]["note"]
    assert plan["channels"] == []


def test_no_room_for_a_bus():
    tracks = template(27)
    tracks[24] = track(24, "Sound 24", routes=[0])
    for i in range(1, 16):
        tracks[i] = track(i, "Sound %d" % i, routes=[0])
    chans = [chan(0, "Kick", 1, fi.SAMPLER), chan(1, "Serum 2", 2)]
    plan = fi.build_plan(tracks, chans, [sound(chans[0], "drums"), sound(chans[1], "instr", "A")])
    assert plan["sounds"][0]["to"] is None and "Drums bus" in plan["sounds"][0]["note"]
    assert plan["sounds"][1]["to"] == 2


def test_undecided_sounds_are_left_alone():
    tracks, chans = blank(), [chan(0, "Serum 2")]
    plan = fi.build_plan(tracks, chans, [sound(chans[0], None)])
    assert plan["changes"] == 0 and plan["channels"] == [] and plan["inserts"] == []


def test_check_reports_what_fl_didnt_do():
    tracks = blank()
    chans = [chan(0, "Kick", 0, fi.SAMPLER)]
    plan = {"channels": [{"index": 0, "target": 3}], "inserts": [{"index": 3, "name": "Kick", "on": [24], "off": [0]}]}
    wrong = fi.check(plan, tracks, chans)
    assert len(wrong) == 4, wrong


# The saved project

def flp(*events):
    body = b""
    for e, v in events:
        if e < 64:
            body += bytes([e, v])
        elif e < 128:
            body += bytes([e]) + struct.pack("<H", v)
        elif e < 192:
            body += bytes([e]) + struct.pack("<I", v)
        else:
            n, length = len(v), b""
            while True:
                b = n & 127
                n >>= 7
                length += bytes([b | (128 if n else 0)])
                if not n:
                    break
            body += bytes([e]) + length + v
    return b"FLhd" + struct.pack("<I", 6) + b"\0" * 6 + b"FLdt" + struct.pack("<I", len(body)) + body


def u16(s):
    return (s + "\0").encode("utf-16-le")


def serum(preset):
    return b'XferJson{"a":1}\x00{"presetName":"%s","x":2}' % preset.encode()


def test_reads_channels():
    raw = flp((64, 0), (21, 2), (203, u16("Serum 2")), (213, serum("LEAD - A")),
              (64, 1), (21, 0), (203, u16("Kick")), (196, u16("C:\\Samples\\Kick.wav")),
              (64, 2), (21, 4), (203, u16("take")), (196, u16("C:\\Rec\\take.wav")),
              (236, b"\0"), (213, serum("On an insert")))
    got = flpread.read_channels(raw)
    assert [c["name"] for c in got] == ["Serum 2", "Kick", "take"]
    assert got[0]["preset"] == "LEAD - A" and got[0]["type"] == 2
    assert got[1]["sample"] == "Kick.wav" and got[1]["preset"] is None
    assert got[2]["preset"] is None  # a Serum on an insert doesn't belong to the last channel


def test_not_an_flp():
    try:
        flpread.read_channels(b"nope")
    except ValueError:
        return
    raise AssertionError("should have said so")


def test_match_and_overlap():
    saved = [{"name": "A", "preset": "1"}, {"name": "A", "preset": "2"}, {"name": "B", "preset": "3"}]
    got = flpread.match(["A", "B", "A", "C"], saved)
    assert [g and g["preset"] for g in got] == ["1", "3", "2", None]
    assert flpread.overlap(saved, ["A", "B", "C", "D"]) == 0.5


def test_find_picks_the_newest_file_with_these_channels():
    with tempfile.TemporaryDirectory() as d:
        right = os.path.join(d, "song.flp")
        wrong = os.path.join(d, "other", "song.flp")
        os.makedirs(os.path.dirname(wrong))
        with open(right, "wb") as f:
            f.write(flp((64, 0), (21, 2), (203, u16("Serum 2"))))
        with open(wrong, "wb") as f:
            f.write(flp((64, 0), (21, 2), (203, u16("Something Else"))))
        os.utime(right, (1000, 1000))
        keep = flpread.candidates, flpread._autosaves
        flpread.candidates = lambda p: [wrong, right]
        flpread._autosaves = lambda p: []
        try:
            path, chans = flpread.find("song", ["Serum 2"])
            assert path == right and chans[0]["name"] == "Serum 2"
            assert flpread.find("song", ["Nothing"]) == (None, [])
        finally:
            flpread.candidates, flpread._autosaves = keep
        assert flpread.find(None, ["Serum 2"]) == (None, [])


def main():
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for name, test in tests:
        try:
            test()
            print("ok  ", name)
        except Exception:
            failed += 1
            print("FAIL", name)
            traceback.print_exc()
    print("%d of %d passed" % (len(tests) - failed, len(tests)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
