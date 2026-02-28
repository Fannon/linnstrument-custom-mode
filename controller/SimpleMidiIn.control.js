loadAPI(17)
host.setShouldFailOnDeprecatedUse(true)

host.defineController(
  'Fannon',
  'Simple MIDI In',
  '0.1.0',
  'a73c2a3d-3b9b-4f52-9c5f-32c4ce8f2ed5',
  'fannon'
)
host.defineMidiPorts(1, 0)
host.addDeviceNameBasedDiscoveryPair(['FannonFoot'], [])

function init () {
  println('Simple MIDI In ready')

  const midiIn = host.getMidiInPort(0)
  midiIn.createNoteInput('FannonFoot', '??????').setShouldConsumeEvents(false)
  midiIn.setMidiCallback(onMidi)
}

function flush () {}

function exit () {}

function onMidi (status, data1, data2) {
  println(`MIDI IN: status=${status} data1=${data1} data2=${data2}`)
}
