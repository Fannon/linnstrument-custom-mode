loadAPI(17)
host.setShouldFailOnDeprecatedUse(true)

const CONTROLLER_NAME = 'Simple MIDI In'

host.defineController(
  'Fannon',
  CONTROLLER_NAME,
  '0.1.1',
  'a73c2a3d-3b9b-4f52-9c5f-32c4ce8f2ed5',
  'fannon'
)
host.defineMidiPorts(1, 0)
host.addDeviceNameBasedDiscoveryPair(['FannonFoot'], [])
host.addDeviceNameBasedDiscoveryPair(['Fannon Foot'], [])
host.addDeviceNameBasedDiscoveryPair(['LinnStrument Custom'], [])

function init () {
  println(`${CONTROLLER_NAME} ready`)

  const midiIn = host.getMidiInPort(0)

  // Use specific masks to include 2-byte messages like Channel Pressure (Dxxxxx)
  const masks = ['8?????', '9?????', 'A?????', 'B?????', 'D?????', 'E?????']
  midiIn.createNoteInput(CONTROLLER_NAME, ...masks).setShouldConsumeEvents(true)
}

function flush () {}

function exit () {}
