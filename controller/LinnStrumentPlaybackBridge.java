package com.tennington.bwextensions.roger_linn_design;

import com.bitwig.extension.controller.ControllerExtension;
import com.bitwig.extension.controller.api.*;

import java.util.logging.Level;
import java.util.logging.Logger;

public class LinnStrumentPlaybackBridge extends ControllerExtension
{
   private static final int MSG_NOTE_ON = 9;

   private static final int MSG_NOTE_OFF = 8;

   int selectedTrack = -1;

   int channel = 1;
   private final boolean[] playbackNoteState = new boolean[128];

   public LinnStrumentPlaybackBridge(final LinnStrumentPlaybackBridgeDefinition definition, final ControllerHost host)
   {
      super(definition, host);
   }

   @Override
   public void init()
   {
      Logger.getGlobal().log(Level.INFO, "Test1");

      final ControllerHost host = getHost();

      host.println("Init");

      final MidiIn midiIn = host.getMidiInPort(0);
      final NoteInput noteInput = midiIn.createNoteInput("", "??????");

      mMidiOut = host.getMidiOutPort(0);

      noteInput.setShouldConsumeEvents(false);

      noteInput.setUseExpressiveMidi(true, 0, 24);

      int sends = 0;
      int scenes = 0;
      int tracks = 100;

      midiIn.setMidiCallback(this::callback);

      var cursorTrack = host.createCursorTrack("MyCursorTrackID", "The Cursor Track", sends, scenes, true);
      var bank = host.createMainTrackBank(tracks, sends, scenes);
      bank.followCursorTrack(cursorTrack);

      for (int i = 0; i < tracks; i++) {
         Track track = bank.getItemAt(i);
         final int index = i;
         track.playingNotes().addValueObserver(arr -> handleNotes(index, track, arr));
      }
      bank.cursorIndex().addValueObserver(index -> {
         selectedTrack = index;
         clearNotes();
      });

      final String[] yesNo = {"Yes", "No"};
      final SettableEnumValue shouldSendInit =
         host.getPreferences().getEnumSetting("Send initialization messages", "MPE", yesNo, "Yes");

      shouldSendInit.addValueObserver(newValue ->
      {
         mShouldSendInit = newValue.equalsIgnoreCase("Yes");

         if (mShouldSendInit && mDidRunInitTask)
         {
            sendInitializationMessages();
            sendPitchbendRange(mPitchBendRange);
         }
      });

      final SettableRangedValue bendRange =
         host.getPreferences().getNumberSetting("Pitch Bend Range", "MPE", 1, 96, 1, "", 48);

      bendRange.addRawValueObserver(range ->
      {
         mPitchBendRange = (int)range;
         noteInput.setUseExpressiveMidi(true, 0, mPitchBendRange);

         if (mShouldSendInit && mDidRunInitTask)
         {
            sendPitchbendRange(mPitchBendRange);
         }
      });

      final String[] playbackModes = {"Main Channel", "Single Channel", "Disabled"};
      final SettableEnumValue lightsOnNotes =
         host.getPreferences().getEnumSetting("Send MIDI on note playback", "Playback", playbackModes, playbackModes[0]);

      lightsOnNotes.addValueObserver(newValue ->
      {
         if (newValue.equalsIgnoreCase(playbackModes[0])) {
            mSendOnUser = false;
            mSendOnMain = true;
         } else if (newValue.equalsIgnoreCase(playbackModes[1])) {
            mSendOnUser = true;
            mSendOnMain = false;
         } else {
            mSendOnUser = false;
            mSendOnMain = false;
         }
      });

      final SettableRangedValue lightsMidi =
         host.getPreferences().getNumberSetting("MIDI Out Channel", "Playback", 1, 16, 1, "", 1);

      lightsMidi.addRawValueObserver(ch ->
      {
         host.println("MIDI playback channel: " + ch);
         clearNotes();
         channel = (int)ch;
      });

      host.scheduleTask(() ->
      {
         mDidRunInitTask = true;

         if (mShouldSendInit)
         {
            sendInitializationMessages();
         }
      }, 2000);
   }

   private void handleNotes(int trackIndex, Track track, final PlayingNote[] playingNotes)
   {
      if (trackIndex == selectedTrack)
      {
         final boolean[] nextState = new boolean[128];
         for (final PlayingNote note : playingNotes)
         {
            final int pitch = note.pitch();
            if (pitch >= 0 && pitch < nextState.length)
            {
               nextState[pitch] = true;
            }
         }

         for (int pitch = 0; pitch < nextState.length; pitch++)
         {
            if (nextState[pitch] && !playbackNoteState[pitch])
            {
               sendPlaybackNoteOn(pitch);
            }
            else if (!nextState[pitch] && playbackNoteState[pitch])
            {
               sendPlaybackNoteOff(pitch);
            }
            playbackNoteState[pitch] = nextState[pitch];
         }
      }
   }

   private void clearNotes()
   {
      for (int i = 0; i < playbackNoteState.length; i++)
      {
         if (playbackNoteState[i])
         {
            playbackNoteState[i] = false;
            sendPlaybackNoteOff(i);
         }
      }
   }

   private void callback(final int i, final int i1, final int i2)
   {
      // getHost().println("MidiCallback: " + i + " " + i1 + " " + i2);
   }

   private void sendPlaybackNoteOn(final int note)
   {
      if (mSendOnUser)
      {
         mMidiOut.sendMidi(statusByte(MSG_NOTE_ON, channel), note, 127);
      }
      if (mSendOnMain)
      {
         mMidiOut.sendMidi(statusByte(MSG_NOTE_ON, 1), note, 127);
      }
   }

   private void sendPlaybackNoteOff(final int note)
   {
      if (mSendOnUser)
      {
         mMidiOut.sendMidi(statusByte(MSG_NOTE_OFF, channel), note, 0);
      }
      if (mSendOnMain)
      {
         mMidiOut.sendMidi(statusByte(MSG_NOTE_OFF, 1), note, 0);
      }
   }

   private int statusByte(final int messageType, final int oneBasedChannel)
   {
      final int normalizedChannel = Math.max(1, Math.min(16, oneBasedChannel)) - 1;
      return (messageType << 4) | normalizedChannel;
   }

   void sendInitializationMessages()
   {
      final MidiOut midiOut = getHost().getMidiOutPort(0);
      // Set up MPE mode: Zone 1 15 channels
      midiOut.sendMidi(0xB0, 101, 0);
      midiOut.sendMidi(0xB0, 100, 6);
      midiOut.sendMidi(0xB0, 6, 15);
      midiOut.sendMidi(0xB0, 38, 0);

      // Set up MPE mode: Zone 2 off
      midiOut.sendMidi(0xBF, 101, 0);
      midiOut.sendMidi(0xBF, 100, 6);
      midiOut.sendMidi(0xBF, 6, 0);
      midiOut.sendMidi(0xBF, 38, 0);
   }

   void sendPitchbendRange(int range)
   {
      final MidiOut midiOut = getHost().getMidiOutPort(0);

      // Set up Pitch bend range
      midiOut.sendMidi(0xB0, 101, 0);
      midiOut.sendMidi(0xB0, 100, 0);
      midiOut.sendMidi(0xB0, 6, range);
      midiOut.sendMidi(0xB0, 38, 0);
   }

   @Override
   public void exit()
   {
   }

   @Override
   public void flush()
   {
   }

   private boolean mShouldSendInit = false;
   private boolean mDidRunInitTask = false;
   private int mPitchBendRange = 48;
   private MidiOut mMidiOut;
   private boolean mSendOnMain = true;
   private boolean mSendOnUser = false;
}
