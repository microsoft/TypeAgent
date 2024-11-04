# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import requests
from bs4 import BeautifulSoup
from structs import Episode
import json

URL = 'https://www.npr.org/programs/all-things-considered/archive'
BASE_URL = 'https://www.npr.org'

def get_podcast_links(page_url):
    response = requests.get(page_url)
    soup = BeautifulSoup(response.text, 'html.parser')

    archive_links = []
    for page_link in soup.find_all('a', href=True):
        link = page_link['href']
        if '/programs/all-things-considered/archive' in link:
            archive_links.append(BASE_URL + link)

    episode_links = []
    for i, archive_link in enumerate(archive_links):
        response = requests.get(archive_link)
        soup = BeautifulSoup(response.text, 'html.parser')

        for episode_link in soup.find_all('a', href=True):
            episode_link_href = episode_link['href']
            if '/programs/all-things-considered/' in episode_link_href and "archive" not in episode_link_href and episode_link_href != "/programs/all-things-considered/":
                episode_links.append(episode_link_href)
        
        print(f"Processed archive page {archive_link} [{i}/{len(archive_links)}] with {len(episode_links)} episodes")

    return episode_links


if __name__ == "__main__":
    # Scrape the archive page
    podcast_links = get_podcast_links(URL)
    print(f"Found {len(podcast_links)} podcast episodes to process")

    # For each podcast episode, extract the transcript
    output_episodes = []
    for i, podcast_link in enumerate(podcast_links):
        print(podcast_link)
        try:
            episode = Episode.from_link(podcast_link)
            output_episodes.append(episode.to_dict())
        except Exception as e:
            print(f"Error processing episode {podcast_link}: {e}")
            continue

        print(f"Processed episode {episode.id} [{i}/{len(podcast_links)}] with {len(episode.sections)} sections")
        with open("npr.json", "w") as f:
            json.dump(output_episodes, f, indent=4)