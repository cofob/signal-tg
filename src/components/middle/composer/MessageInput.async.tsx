import type { OwnProps } from './MessageInput';

import { EDITABLE_INPUT_ID } from '../../../config';
import { Bundles } from '../../../util/moduleLoader';

import useModuleLoader from '../../../hooks/useModuleLoader';

const MessageInputAsync = (props: OwnProps) => {
  const {
    ref,
    id,
    editableInputId,
    placeholder,
  } = props;
  const MessageInput = useModuleLoader(Bundles.Editor, 'MessageInput');

  if (MessageInput) {
    return <MessageInput {...props} />;
  }

  const placeholderId = `${editableInputId || EDITABLE_INPUT_ID}-placeholder`;

  return (
    <div id={id} aria-busy>
      <div className="shared-canvas-container">
        <div className="custom-scroll input-scroller">
          <div className="input-scroller-content">
            <div
              ref={ref}
              id={editableInputId || EDITABLE_INPUT_ID}
              className="form-control allow-selection focus-disabled"
              role="textbox"
              aria-disabled
              aria-labelledby={placeholderId}
              tabIndex={-1}
            />
            <span
              id={placeholderId}
              className="placeholder-text"
              dir="auto"
            >
              {placeholder}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessageInputAsync;
