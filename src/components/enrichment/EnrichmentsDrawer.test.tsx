import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import EnrichmentsDrawer from './EnrichmentsDrawer';
import { makeEd } from '../../test/mockEd';
import type { EnrichmentObject } from '../../types';

const obj = (over: Partial<EnrichmentObject>): EnrichmentObject => ({
  identifier: 'do_x', enrichmentObjectType: 'Transcript', parentId: 'do_1', status: 'Live', ...over,
});

const open = (over = {}) => makeEd({ drawer: 'enrichments', enrichmentDrawerType: 'Transcript', ...over });

describe('<EnrichmentsDrawer />', () => {
  it('takes its title from the registry entry of the open type', () => {
    render(<EnrichmentsDrawer ed={open()} />);
    expect(screen.getByText('Transcripts & captions')).toBeInTheDocument();
  });

  it("hands the panel only the open type's objects", () => {
    const ed = open({
      enrichmentObjects: [
        obj({ identifier: 't1', language: 'English', sourceLanguage: true }),
        obj({ identifier: 's1', enrichmentObjectType: 'Summary', language: 'Summary-only' }),
      ],
    });
    render(<EnrichmentsDrawer ed={ed} />);
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.queryByText('Summary-only')).not.toBeInTheDocument();
  });

  it('shows a spinner while the list is loading (negative)', () => {
    const { container } = render(<EnrichmentsDrawer ed={open({ enrichmentsLoading: true })} />);
    expect(container.querySelector('.ce-spinner')).toBeInTheDocument();
    expect(screen.queryByText('No transcripts yet')).not.toBeInTheDocument();
  });

  it('shows the load error with a Retry that calls reloadEnrichments (negative)', () => {
    const reloadEnrichments = vi.fn();
    render(<EnrichmentsDrawer ed={open({ enrichmentsError: true, reloadEnrichments })} />);
    expect(screen.getByText("Couldn't load transcripts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reloadEnrichments).toHaveBeenCalledTimes(1);
  });

  it("shows the type's empty state when it has no objects", () => {
    render(<EnrichmentsDrawer ed={open()} />);
    expect(screen.getByText('No transcripts yet')).toBeInTheDocument();
  });

  it('renders no panel for an unregistered type (negative)', () => {
    render(<EnrichmentsDrawer ed={open({ enrichmentDrawerType: 'Unknown' })} />);
    expect(screen.queryByText('No transcripts yet')).not.toBeInTheDocument();
  });

  it('closes via setDrawer(null)', () => {
    const setDrawer = vi.fn();
    render(<EnrichmentsDrawer ed={open({ setDrawer })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(setDrawer).toHaveBeenCalledWith(null);
  });
});
