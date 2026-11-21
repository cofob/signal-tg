import { type FC, memo } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import type { TabState } from '../../global/types';

import { selectCanAnimateInterface, selectTabState } from '../../global/selectors';
import { pick } from '../../util/iteratees';

import useCurrentOrPrev from '../../hooks/useCurrentOrPrev';
import useShowTransition from '../../hooks/useShowTransition';

import SafeLinkModal from '../main/SafeLinkModal.async';
import StoryComposerModal from '../story/StoryComposerModal.async';
import AgeVerificationModal from './ageVerification/AgeVerificationModal.async';
import AudioPlaylistModal from './audioPlaylist/AudioPlaylistModal.async';
import AutoDeleteTimerModal from './autoDeleteTimer/AutoDeleteTimerModal.async';
import BirthdaySetupModal from './birthday/BirthdaySetupModal.async';
import ChatInviteModal from './chatInvite/ChatInviteModal.async';
import DeleteAccountModal from './deleteAccount/DeleteAccountModal.async';
import DeleteMemberModal from './deleteMember/DeleteMemberModal.async';
import DisableSharingAboutModal from './disableSharing/DisableSharingAboutModal.async';
import FrozenAccountModal from './frozenAccount/FrozenAccountModal.async';
import InviteViaLinkModal from './inviteViaLink/InviteViaLinkModal.async';
import LanguageModal from './language/LanguageModal.async';
import MessageDetailsModal from './messageDetails/MessageDetailsModal.async';
import MusicPickerModal from './musicPicker/MusicPickerModal.async';
import OneTimeMediaModal from './oneTimeMedia/OneTimeMediaModal.async';
import PhoneNumberLookupModal from './phoneNumberLookup/PhoneNumberLookupModal';
import PollModal from './poll/PollModal.async';
import QrCodeModal from './qrCode/QrCodeModal.async';
import QuickChatPickerModal from './quickChatPicker/QuickChatPickerModal.async';
import QuickPreviewModal from './quickPreview/QuickPreviewModal.async';
import EditRankModal from './rank/EditRankModal.async';
import RankModal from './rank/RankModal.async';
import RecoveryKeyModal from './recoveryKey/RecoveryKeyModal.async';
import ReportModal from './reportModal/ReportModal.async';
import SafetyNumberModal from './safetyNumber/SafetyNumberModal.async';
import SafetyNumberChangeModal from './safetyNumberChange/SafetyNumberChangeModal.async';
import SettingsConfirmationModal from './settingsConfirmation/SettingsConfirmationModal.async';
import SignalLinkModal from './signalLink/SignalLinkModal';

// `Pick` used only to provide tab completion
type ModalKey = keyof Pick<TabState,
  'safeLinkModalUrl' |
  'oneTimeMediaModal' |
  'inviteViaLinkModal' |
  'reportModal' |
  'pollModal' |
  'musicPicker' |
  'chatInviteModal' |
  'disableSharingAboutModal' |
  'isFrozenAccountModalOpen' |
  'deleteAccountModal' |
  'deleteMemberModal' |
  'isAgeVerificationModalOpen' |
  'qrCodeModal' |
  'safetyNumberModal' |
  'safetyNumberChangeModal' |
  'messageDetailsModal' |
  'recoveryKeyModal' |
  'quickPreview' |
  'storyComposerModal' |
  'isAudioPlaylistModalOpen' |
  'birthdaySetupModal' |
  'isQuickChatPickerOpen' |
  'editRankModal' |
  'rankModal' |
  'languageModal' |
  'autoDeleteTimerModal' |
  'settingsConfirmation' |
  'phoneNumberLookupModal' |
  'signalLinkModal'
>;
type WrappedModalKey = 'pollModal' | 'musicPicker' | 'safeLinkModalUrl' | 'autoDeleteTimerModal'
  | 'settingsConfirmation'
  | 'phoneNumberLookupModal' | 'signalLinkModal';
type LegacyModalKey = Exclude<ModalKey, WrappedModalKey>;

type ModalStateProps = {
  [K in ModalKey]?: TabState[K];
};
type StateProps = ModalStateProps & {
  shouldAnimateInterface: boolean;
};
type LegacyModalRegistry = {
  [K in LegacyModalKey]: FC<{
    modal: TabState[K];
  }>;
};
type WrappedModalRegistry = {
  [K in WrappedModalKey]: FC<{
    modal: NonNullable<TabState[K]>;
    isOpen: boolean;
  }>;
};
type Entries<T> = {
  [K in keyof T]: [K, T[K]];
}[keyof T][];

const WRAPPED_MODAL_CLOSE_DURATION = 200;

type WrappedModalBoundaryProps<T> = {
  modal: T;
  ModalComponent: FC<{
    modal: NonNullable<T>;
    isOpen: boolean;
  }>;
  shouldAnimateInterface: boolean;
};

const WrappedModalBoundary = <T,>({
  modal,
  ModalComponent,
  shouldAnimateInterface,
}: WrappedModalBoundaryProps<T>) => {
  const isOpen = Boolean(modal);
  const renderingModal = useCurrentOrPrev(modal, true);
  const { shouldRender } = useShowTransition({
    isOpen,
    withShouldRender: true,
    closeDuration: WRAPPED_MODAL_CLOSE_DURATION,
    noCloseTransition: !shouldAnimateInterface,
  });

  if (!shouldRender || !renderingModal) {
    return undefined;
  }

  return <ModalComponent modal={renderingModal} isOpen={isOpen} />;
};

const LEGACY_MODALS: LegacyModalRegistry = {
  oneTimeMediaModal: OneTimeMediaModal,
  inviteViaLinkModal: InviteViaLinkModal,
  reportModal: ReportModal,
  chatInviteModal: ChatInviteModal,
  disableSharingAboutModal: DisableSharingAboutModal,
  isFrozenAccountModalOpen: FrozenAccountModal,
  deleteAccountModal: DeleteAccountModal,
  deleteMemberModal: DeleteMemberModal,
  isAgeVerificationModalOpen: AgeVerificationModal,
  qrCodeModal: QrCodeModal,
  safetyNumberModal: SafetyNumberModal,
  safetyNumberChangeModal: SafetyNumberChangeModal,
  messageDetailsModal: MessageDetailsModal,
  recoveryKeyModal: RecoveryKeyModal,
  quickPreview: QuickPreviewModal,
  storyComposerModal: StoryComposerModal,
  isAudioPlaylistModalOpen: AudioPlaylistModal,
  birthdaySetupModal: BirthdaySetupModal,
  isQuickChatPickerOpen: QuickChatPickerModal,
  editRankModal: EditRankModal,
  rankModal: RankModal,
  languageModal: LanguageModal,
};
const WRAPPED_MODALS: WrappedModalRegistry = {
  pollModal: PollModal,
  musicPicker: MusicPickerModal,
  safeLinkModalUrl: SafeLinkModal,
  autoDeleteTimerModal: AutoDeleteTimerModal,
  settingsConfirmation: SettingsConfirmationModal,
  phoneNumberLookupModal: PhoneNumberLookupModal,
  signalLinkModal: SignalLinkModal,
};

const LEGACY_MODAL_KEYS = Object.keys(LEGACY_MODALS) as LegacyModalKey[];
const WRAPPED_MODAL_KEYS = Object.keys(WRAPPED_MODALS) as WrappedModalKey[];
const MODAL_KEYS = [...LEGACY_MODAL_KEYS, ...WRAPPED_MODAL_KEYS] as ModalKey[];

const LEGACY_MODAL_ENTRIES = Object.entries(LEGACY_MODALS) as Entries<LegacyModalRegistry>;
const WRAPPED_MODAL_ENTRIES = Object.entries(WRAPPED_MODALS) as Entries<WrappedModalRegistry>;

function renderWrappedModal<K extends WrappedModalKey>(
  key: K,
  ModalComponent: WrappedModalRegistry[K],
  modal: TabState[K],
  shouldAnimateInterface: boolean,
) {
  return (
    <WrappedModalBoundary<TabState[K]>
      key={key}
      modal={modal}
      ModalComponent={ModalComponent}
      shouldAnimateInterface={shouldAnimateInterface}
    />
  );
}

const ModalContainer = (modalProps: StateProps) => {
  const { shouldAnimateInterface } = modalProps;

  return [
    ...LEGACY_MODAL_ENTRIES.map(([key, ModalComponent]) => (
      // @ts-ignore -- TS does not preserve tuple types in `map` callbacks
      <ModalComponent key={key} modal={modalProps[key]} />
    )),
    ...WRAPPED_MODAL_ENTRIES.map(([key, ModalComponent]) => {
      return renderWrappedModal(key, ModalComponent, modalProps[key], shouldAnimateInterface);
    }),
  ];
};

export default memo(withGlobal(
  (global): Complete<StateProps> => ({
    ...(pick(selectTabState(global), MODAL_KEYS) as Complete<ModalStateProps>),
    shouldAnimateInterface: selectCanAnimateInterface(global),
  }),
)(ModalContainer));
