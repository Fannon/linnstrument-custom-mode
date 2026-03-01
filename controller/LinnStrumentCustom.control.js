/**
 * LinnStrument Custom
 * Simplified Bitwig controller script for LinnStrument backchannel highlighting.
 *
 * - Passes LinnStrument input through Bitwig's NoteInput (no remapping/retriggering).
 * - Sends playback note highlights from the selected track back to MIDI Out.
 * - Suppresses immediate echo of live-played notes to avoid duplicates/feedback.
 */
loadAPI(17)
host.setShouldFailOnDeprecatedUse(true)
host.defineController(
  'Roger Linn Design',
  'LinnStrument Custom',
  '0.1.0',
  'adad919a-038e-4963-bf6c-f8b8ca714c41',
  'fannon'
)
host.defineMidiPorts(1, 1)
host.addDeviceNameBasedDiscoveryPair(['LinnStrument MIDI'], ['LinnStrument MIDI'])
host.addDeviceNameBasedDiscoveryPair(['LinnStrument MIDI 1'], ['LinnStrument MIDI 1'])
host.addDeviceNameBasedDiscoveryPair(['LinnStrument Custom'], ['LinnStrument Custom'])
host.addDeviceNameBasedDiscoveryPair(['LinnStrument Custom MIDI 1'], ['LinnStrument Custom MIDI 1'])

const MSG_NOTE_ON = 0x90
const MSG_NOTE_OFF = 0x80

const SHOULD_SEND_INIT = true
const USE_MPE_MODE = true
const PITCH_BEND_RANGE = 48
const SEND_ON_MAIN = true
const SEND_ON_USER = false
const USER_PLAYBACK_CHANNEL = 1 // 1..16
const ECHO_SUPPRESS_MS = 120
const TRACK_COUNT = 100

let midiOut = null
let noteInput = null
let selectedTrackIndex = -1

const observedPlaybackState = Array(128).fill(false)
const sentPlaybackState = Array(128).fill(false)
const recentInputAtMs = Array.from({ length: 16 }, () => Array(128).fill(0))

function init () {
  println('LinnStrument Custom ready')

  const midiIn = host.getMidiInPort(0)
  midiOut = host.getMidiOutPort(0)

  noteInput = midiIn.createNoteInput('LinnStrument In', '8?????', '9?????', 'A?????', 'B?????', 'D?????', 'E?????')
  noteInput.setShouldConsumeEvents(false)

  if (typeof noteInput.setUseExpressiveMidi === 'function') {
    noteInput.setUseExpressiveMidi(USE_MPE_MODE, 0, PITCH_BEND_RANGE)
  }

  midiIn.setMidiCallback(onMidi)

  const cursorTrack = host.createCursorTrack('ls-backchannel-cursor', 'LinnStrument Cursor', 0, 0, true)
  const bank = host.createMainTrackBank(TRACK_COUNT, 0, 0)
  bank.followCursorTrack(cursorTrack)

  for (let i = 0; i < TRACK_COUNT; i++) {
    const track = bank.getItemAt(i)
    const index = i
    track.playingNotes().addValueObserver((notes) => handlePlayingNotes(index, notes))
  }

  bank.cursorIndex().addValueObserver((index) => {
    selectedTrackIndex = index
    clearAllSentNotes()
    for (let i = 0; i < observedPlaybackState.length; i++) {
      observedPlaybackState[i] = false
    }
  })

  if (SHOULD_SEND_INIT) {
    host.scheduleTask(() => {
      sendInitializationMessages()
      sendPitchBendRange(PITCH_BEND_RANGE)
    }, 1000)
  }
}

function flush () {}

function exit () {
  clearAllSentNotes()
}

function onMidi (status, data1, data2) {
  const msg = status & 0xF0
  const channelZeroBased = status & 0x0F

  if (msg === 0xE0) {
    // Pitch Bend debug
    const pb = (data2 << 7) | data1
    println('Pitch Bend: ' + pb + ' (Ch ' + (channelZeroBased + 1) + ')')
  } else if (msg === 0xB0) {
    // CC debug
    println('CC ' + data1 + ': ' + data2 + ' (Ch ' + (channelZeroBased + 1) + ')')
  } else if (msg === 0xD0) {
    // Channel Pressure debug
    println('Pressure: ' + data1 + ' (Ch ' + (channelZeroBased + 1) + ')')
  }

  if (data1 >= 0 && data1 <= 127) {
    const isNoteOn = msg === MSG_NOTE_ON && data2 > 0
    const isNoteOff = msg === MSG_NOTE_OFF || (msg === MSG_NOTE_ON && data2 === 0)

    if (isNoteOn || isNoteOff) {
      recentInputAtMs[channelZeroBased][data1] = Date.now()
    }
  }
}

function handlePlayingNotes (trackIndex, playingNotes) {
  if (trackIndex !== selectedTrackIndex) {
    return
  }

  const nextObserved = Array(128).fill(false)

  for (let i = 0; i < playingNotes.length; i++) {
    const pitch = extractPitch(playingNotes[i])
    if (pitch >= 0 && pitch <= 127) {
      nextObserved[pitch] = true
    }
  }

  for (let pitch = 0; pitch < 128; pitch++) {
    const becameOn = nextObserved[pitch] && !observedPlaybackState[pitch]
    const becameOff = !nextObserved[pitch] && observedPlaybackState[pitch]

    if (becameOn) {
      if (!wasRecentlyPlayedFromInput(pitch)) {
        sendPlaybackNoteOn(pitch)
        sentPlaybackState[pitch] = true
      }
    } else if (becameOff) {
      if (sentPlaybackState[pitch]) {
        sendPlaybackNoteOff(pitch)
        sentPlaybackState[pitch] = false
      }
    }

    observedPlaybackState[pitch] = nextObserved[pitch]
  }
}

function extractPitch (playingNote) {
  if (playingNote == null) {
    return -1
  }

  if (typeof playingNote.pitch === 'function') {
    return playingNote.pitch()
  }

  if (typeof playingNote.pitch === 'number') {
    return playingNote.pitch
  }

  if (Array.isArray(playingNote) && playingNote.length > 0 && typeof playingNote[0] === 'number') {
    return playingNote[0]
  }

  return -1
}

function wasRecentlyPlayedFromInput (pitch) {
  const now = Date.now()
  for (let ch = 0; ch < 16; ch++) {
    if (now - recentInputAtMs[ch][pitch] <= ECHO_SUPPRESS_MS) {
      return true
    }
  }
  return false
}

function clearAllSentNotes () {
  for (let pitch = 0; pitch < 128; pitch++) {
    if (sentPlaybackState[pitch]) {
      sendPlaybackNoteOff(pitch)
      sentPlaybackState[pitch] = false
    }
  }
}

function sendPlaybackNoteOn (note) {
  if (!midiOut) {
    return
  }

  if (SEND_ON_USER) {
    midiOut.sendMidi(statusByte(MSG_NOTE_ON, USER_PLAYBACK_CHANNEL), note, 127)
  }
  if (SEND_ON_MAIN) {
    midiOut.sendMidi(statusByte(MSG_NOTE_ON, 1), note, 127)
  }
}

function sendPlaybackNoteOff (note) {
  if (!midiOut) {
    return
  }

  if (SEND_ON_USER) {
    midiOut.sendMidi(statusByte(MSG_NOTE_OFF, USER_PLAYBACK_CHANNEL), note, 0)
  }
  if (SEND_ON_MAIN) {
    midiOut.sendMidi(statusByte(MSG_NOTE_OFF, 1), note, 0)
  }
}

function statusByte (messageType, oneBasedChannel) {
  const normalizedChannel = clamp(oneBasedChannel, 1, 16) - 1
  return messageType | normalizedChannel
}

function sendInitializationMessages () {
  if (!midiOut) {
    return
  }

  // MPE mode: lower zone with specified member channels.
  // Using 15 member channels for MPE, or 0 for non-MPE (single channel).
  const memberChannels = USE_MPE_MODE ? 15 : 0
  midiOut.sendMidi(0xB0, 101, 0)
  midiOut.sendMidi(0xB0, 100, 6)
  midiOut.sendMidi(0xB0, 6, memberChannels)
  midiOut.sendMidi(0xB0, 38, 0)

  // Disable upper zone.
  midiOut.sendMidi(0xBF, 101, 0)
  midiOut.sendMidi(0xBF, 100, 6)
  midiOut.sendMidi(0xBF, 6, 0)
  midiOut.sendMidi(0xBF, 38, 0)
}

function sendPitchBendRange (range) {
  if (!midiOut) {
    return
  }

  const safeRange = clamp(Math.round(range), 1, 96)
  midiOut.sendMidi(0xB0, 101, 0)
  midiOut.sendMidi(0xB0, 100, 0)
  midiOut.sendMidi(0xB0, 6, safeRange)
  midiOut.sendMidi(0xB0, 38, 0)
}

function clamp (value, min, max) {
  return Math.max(min, Math.min(max, value))
}
