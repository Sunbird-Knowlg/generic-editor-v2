import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Header from './Header';
import { makeEd, mockContent } from '../test/mockEd';

describe('<Header />', () => {
  it('shows the content title', () => {
    const ed = makeEd({ view: 'player', content: mockContent });
    render(<Header ed={ed} />);
    expect(screen.getByText('Sample content')).toBeInTheDocument();
  });

  it('renders the saved appIcon as the far-left logo when present', () => {
    const ed = makeEd({ view: 'player', content: { ...mockContent, appIcon: 'https://cdn/icon.png' } });
    const { container } = render(<Header ed={ed} />);
    const img = container.querySelector('.ce-logo-mark img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain('https://cdn/icon.png');
  });

  it('opens the collaborator drawer from the icon button', () => {
    const setDrawer = vi.fn();
    const ed = makeEd({ view: 'player', mode: 'edit', setDrawer });
    render(<Header ed={ed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add collaborators' }));
    expect(setDrawer).toHaveBeenCalledWith('collaborator');
  });

  it('disables action buttons while busy (negative)', () => {
    const ed = makeEd({ view: 'player', mode: 'edit', busy: true });
    render(<Header ed={ed} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add collaborators' })).toBeDisabled();
  });

  it('shows Publish for a reviewer and wires it up', () => {
    const publish = vi.fn();
    const ed = makeEd({ view: 'player', mode: 'review', publish });
    render(<Header ed={ed} />);
    const btn = screen.getByRole('button', { name: /Publish/ });
    fireEvent.click(btn);
    expect(publish).toHaveBeenCalled();
  });

  it('shows "View transcript" once the content has Transcript objects, and opens the drawer for that type', () => {
    const openEnrichmentDrawer = vi.fn();
    const ed = makeEd({
      view: 'player', mode: 'edit', openEnrichmentDrawer, presentEnrichmentTypes: ['Transcript'],
      content: { ...mockContent, mimeType: 'video/mp4' },
    });
    render(<Header ed={ed} />);
    fireEvent.click(screen.getByRole('button', { name: 'View transcript' }));
    expect(openEnrichmentDrawer).toHaveBeenCalledWith('Transcript');
  });

  it('hides "View transcript" when no enrichment type is present (negative)', () => {
    const ed = makeEd({
      view: 'player', mode: 'edit', presentEnrichmentTypes: [],
      content: { ...mockContent, mimeType: 'video/mp4' },
    });
    render(<Header ed={ed} />);
    expect(screen.queryByRole('button', { name: 'View transcript' })).not.toBeInTheDocument();
  });

  it('skips a present type that has no registry entry (negative)', () => {
    const ed = makeEd({ view: 'player', mode: 'edit', presentEnrichmentTypes: ['Unknown'] });
    render(<Header ed={ed} />);
    expect(screen.queryByRole('button', { name: 'View transcript' })).not.toBeInTheDocument();
  });

  it('disables the enrichment button while busy (negative)', () => {
    const ed = makeEd({ view: 'player', mode: 'edit', busy: true, presentEnrichmentTypes: ['Transcript'] });
    render(<Header ed={ed} />);
    expect(screen.getByRole('button', { name: 'View transcript' })).toBeDisabled();
  });
});
