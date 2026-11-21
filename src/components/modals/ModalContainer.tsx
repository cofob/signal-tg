import { type FC, memo } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import type { TabState } from '../../global/types';

import { selectCanAnimateInterface, selectTabState } from '../../global/selectors';
import { pick } from '../../util/iteratees';

import useCurrentOrPrev from '../../hooks/useCurrentOrPrev';
import useShowTransition from '../../hooks/useShowTransition';

import SafeLinkModal from '../main/SafeLinkModal.async';
import AiMessageEditorModal from '../middle/composer/AiMessageEditorModal/AiMessageEditorModal.async';
import AgeVerificationModal from './ageVerification/AgeVerificationModal.async';
import AiTonePreviewModal from './aiTonePreview/AiTonePreviewModal.async';
import AudioPlaylistModal from './audioPlaylist/AudioPlaylistModal.async';
import AutoDeleteTimerModal from './autoDeleteTimer/AutoDeleteTimerModal.async';
import BirthdaySetupModal from './birthday/BirthdaySetupModal.async';
import ChatInviteModal from './chatInvite/ChatInviteModal.async';
import ChatlistModal from './chatlist/ChatlistModal.async';
import CocoonModal from './cocoon/CocoonModal.async';
import DeleteAccountModal from './deleteAccount/DeleteAccountModal.async';
import DeleteMemberModal from './deleteMember/DeleteMemberModal.async';
import DisableSharingAboutModal from './disableSharing/DisableSharingAboutModal.async';
import FrozenAccountModal from './frozenAccount/FrozenAccountModal.async';
import InviteViaLinkModal from './inviteViaLink/InviteViaLinkModal.async';
import JoinGroupCallModal from './joinGroupCall/JoinGroupCallModal.async';
import LanguageModal from './language/LanguageModal.async';
import MusicPickerModal from './musicPicker/MusicPickerModal.async';
import OneTimeMediaModal from './oneTimeMedia/OneTimeMediaModal.async';
import PollModal from './poll/PollModal.async';
import ProfileRatingModal from './profileRating/ProfileRatingModal.async';
import QrCodeModal from './qrCode/QrCodeModal.async';
import QuickChatPickerModal from './quickChatPicker/QuickChatPickerModal.async';
import QuickPreviewModal from './quickPreview/QuickPreviewModal.async';
import EditRankModal from './rank/EditRankModal.async';
import RankModal from './rank/RankModal.async';
import ReportModal from './reportModal/ReportModal.async';
import SettingsConfirmationModal from './settingsConfirmation/SettingsConfirmationModal.async';
import StealthModeModal from './storyStealthMode/StealthModeModal.async';
import SuggestedPostApprovalModal from './suggestedPostApproval/SuggestedPostApprovalModal.async';
import SuggestMessageModal from './suggestMessage/SuggestMessageModal.async';

// `Pick` used only to provide tab completion
type ModalKey = keyof Pick<TabState,
  'aiMessageEditorModal' |
  'chatlistModal' |
  'safeLinkModalUrl' |
  'oneTimeMediaModal' |
  'inviteViaLinkModal' |
  'reportModal' |
  'pollModal' |
  'musicPicker' |
  'suggestMessageModal' |
  'suggestedPostApprovalModal' |
  'chatInviteModal' |
  'disableSharingAboutModal' |
  'isFrozenAccountModalOpen' |
  'deleteAccountModal' |
  'deleteMemberModal' |
  'isAgeVerificationModalOpen' |
  'profileRatingModal' |
  'qrCodeModal' |
  'quickPreview' |
  'storyStealthModal' |
  'isAudioPlaylistModalOpen' |
  'birthdaySetupModal' |
  'isQuickChatPickerOpen' |
  'isCocoonModalOpen' |
  'editRankModal' |
  'rankModal' |
  'aiTonePreviewModal' |
  'languageModal' |
  'autoDeleteTimerModal' |
  'settingsConfirmation' |
  'joinGroupCallModal'
>;
type WrappedModalKey = 'pollModal' | 'musicPicker' | 'safeLinkModalUrl' | 'autoDeleteTimerModal'
  | 'settingsConfirmation' | 'joinGroupCallModal';
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
  aiMessageEditorModal: AiMessageEditorModal,
  chatlistModal: ChatlistModal,
  oneTimeMediaModal: OneTimeMediaModal,
  inviteViaLinkModal: InviteViaLinkModal,
  reportModal: ReportModal,
  chatInviteModal: ChatInviteModal,
  suggestMessageModal: SuggestMessageModal,
  suggestedPostApprovalModal: SuggestedPostApprovalModal,
  disableSharingAboutModal: DisableSharingAboutModal,
  isFrozenAccountModalOpen: FrozenAccountModal,
  deleteAccountModal: DeleteAccountModal,
  deleteMemberModal: DeleteMemberModal,
  isAgeVerificationModalOpen: AgeVerificationModal,
  profileRatingModal: ProfileRatingModal,
  qrCodeModal: QrCodeModal,
  quickPreview: QuickPreviewModal,
  storyStealthModal: StealthModeModal,
  isAudioPlaylistModalOpen: AudioPlaylistModal,
  birthdaySetupModal: BirthdaySetupModal,
  isQuickChatPickerOpen: QuickChatPickerModal,
  isCocoonModalOpen: CocoonModal,
  editRankModal: EditRankModal,
  rankModal: RankModal,
  aiTonePreviewModal: AiTonePreviewModal,
  languageModal: LanguageModal,
};
const WRAPPED_MODALS: WrappedModalRegistry = {
  pollModal: PollModal,
  musicPicker: MusicPickerModal,
  safeLinkModalUrl: SafeLinkModal,
  autoDeleteTimerModal: AutoDeleteTimerModal,
  settingsConfirmation: SettingsConfirmationModal,
  joinGroupCallModal: JoinGroupCallModal,
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
